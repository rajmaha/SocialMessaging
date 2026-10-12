import paramiko
import os
import re
import shlex
import hashlib
import secrets
import string
import logging
from app.schemas.cloudpanel import CloudPanelSiteCreate
from app.models.cloudpanel_server import CloudPanelServer

logger = logging.getLogger(__name__)

class CloudPanelService:
    def __init__(self, server: CloudPanelServer):
        self.server = server
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
    def __enter__(self):
        self._connect()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.client.close()
        
    def _connect(self):
        kwargs = {
            "hostname": self.server.host,
            "port": self.server.ssh_port,
            "username": self.server.ssh_user,
        }
        if self.server.ssh_key:
            from io import StringIO
            pkey = None
            for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.DSSKey]:
                try:
                    pkey = key_class.from_private_key(StringIO(self.server.ssh_key))
                    break
                except Exception:
                    continue
            if pkey is None:
                raise ValueError("Could not parse SSH private key (unsupported key type)")
            kwargs["pkey"] = pkey
        elif self.server.ssh_password:
            kwargs["password"] = self.server.ssh_password
        else:
            raise ValueError("No SSH credentials provided")
            
        self.client.connect(**kwargs)

    def _execute(self, command: str) -> str:
        logger.info(f"Executing CloudPanel SSH command: {command}")
        stdin, stdout, stderr = self.client.exec_command(command)
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8')
        err = stderr.read().decode('utf-8')
        if exit_status != 0:
            raise Exception(f"Command failed with status {exit_status}: {err} \n Output: {out}")
        return out

    # ------------------------------------------------------------------
    # Mounts inside a site's folder
    # ------------------------------------------------------------------
    # auto-run-script.sh bind-mounts /home/shared/saraloms-app/asset and
    # .../oms-app-1.3.0 into the site's document root. `clpctl site:delete`
    # removes the site's home folder recursively, and a recursive delete
    # walks INTO a bind mount: deleting a site with its mounts in place
    # would empty the shared app every other site runs on. So every mount
    # under the site is taken off first, and the delete is refused while
    # any remains.

    def _sudo(self) -> str:
        return "" if (self.server.ssh_user or "") == "root" else "sudo -n "

    @staticmethod
    def _unescape_mount_path(path: str) -> str:
        # /proc/self/mounts writes space, tab, newline and backslash as
        # octal escapes (\040, \011, \012, \134).
        return re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), path)

    def _mount_targets(self) -> list:
        out = self._execute("cat /proc/self/mounts")
        targets = []
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                targets.append(self._unescape_mount_path(parts[1]))
        return targets

    def site_folders(self, domain: str, site_user: str = None) -> list:
        """The folders a site deletion removes: its home and document root."""
        bases = []
        try:
            root = self._execute(
                f"grep -m1 -oP 'root\\s+\\K[^;]+' /etc/nginx/sites-enabled/{shlex.quote(domain + '.conf')}"
            ).strip()
        except Exception:
            root = ""
        if root.startswith("/"):
            bases.append(root.rstrip("/"))
            m = re.match(r"^(/home/[^/]+)", root)
            if m:
                bases.append(m.group(1))
        if site_user and re.match(r"^[A-Za-z0-9._-]+$", site_user):
            bases.append(f"/home/{site_user}")
        # Never treat a top-level folder (/, /home) as a site's own.
        return sorted({b for b in bases if b.count("/") >= 2})

    def site_mounts(self, domain: str, site_user: str = None) -> list:
        bases = self.site_folders(domain, site_user)
        marker = f"/htdocs/{domain}"
        found = set()
        for target in self._mount_targets():
            t = target.rstrip("/") or "/"
            if any(t == b or t.startswith(b + "/") for b in bases):
                found.add(t)
            elif t.endswith(marker) or (marker + "/") in t:
                found.add(t)
        # Deepest first, so a mount inside another comes off before it.
        return sorted(found, key=lambda p: (p.count("/"), len(p)), reverse=True)

    def unmount_site(self, domain: str, site_user: str = None) -> list:
        """Unmount everything mounted inside the site. Returns what was
        unmounted; raises if anything is still mounted afterwards."""
        sudo = self._sudo()
        mounts = self.site_mounts(domain, site_user)
        for target in mounts:
            q = shlex.quote(target)
            try:
                self._execute(f"{sudo}umount {q}")
            except Exception as e:
                # Busy (a shell or PHP worker inside it): a lazy unmount
                # detaches it from the tree at once, which is what keeps
                # the recursive delete out of the shared folder.
                logger.warning(f"umount {target} failed ({e}); trying lazy unmount")
                self._execute(f"{sudo}umount -l {q}")

        still = self.site_mounts(domain, site_user)
        if still:
            raise Exception(
                "These folders are still mounted inside the site, so its files were "
                "not deleted (deleting them would delete the shared files behind "
                "the mount): " + ", ".join(still)
            )

        # A mount written into /etc/fstab would be mounted again at the next
        # boot onto a folder that no longer exists; take its line out
        # (a dated copy of fstab is kept).
        # Only plain paths go into the awk program, as string literals.
        bases = [b for b in self.site_folders(domain, site_user)
                 if re.match(r"^/[A-Za-z0-9._/-]+$", b)]
        if bases:
            conds = " || ".join(
                f'$2=="{b}" || index($2, "{b}/")==1' for b in bases
            )
            awk_match = f"awk '!/^[[:space:]]*#/ && ({conds}) {{found=1}} END {{exit !found}}' /etc/fstab"
            try:
                self._execute(awk_match)
                has_lines = True
            except Exception:
                has_lines = False
            if has_lines:
                self._execute(
                    f"{sudo}cp -p /etc/fstab /etc/fstab.bak-$(date +%Y%m%d%H%M%S) && "
                    f"awk '/^[[:space:]]*#/ || !({conds})' /etc/fstab > /tmp/fstab.oms.$$ && "
                    f"{sudo}cp /tmp/fstab.oms.$$ /etc/fstab && rm -f /tmp/fstab.oms.$$"
                )
                logger.info(f"Removed fstab entries for {domain}")
        return mounts

    def _get_parent_domain_user(self, root_domain: str):
        """
        If the parent domain already exists on this CloudPanel server, return
        (sys_user, htdocs_root) so the subdomain can be deployed under the same
        user.  Returns (None, None) when the parent domain is not yet set up.
        """
        try:
            # CloudPanel nginx vhosts live at /etc/nginx/sites-enabled/<domain>.conf
            # The 'root' directive tells us exactly where the site lives and who owns it.
            # e.g.  root /home/saraloms/htdocs/saraloms.com;
            vhost_root = self._execute(
                f"grep -m1 -oP 'root\\s+\\K[^;]+' /etc/nginx/sites-enabled/{root_domain}.conf"
            ).strip()
            if not vhost_root:
                return None, None

            # Extract system user from path  /home/<user>/htdocs/...
            parts = vhost_root.split("/")
            # parts: ['', 'home', '<user>', 'htdocs', ...]
            if len(parts) >= 3 and parts[1] == "home":
                sys_user = parts[2]
                htdocs_root = vhost_root  # document root of the parent domain
                return sys_user, htdocs_root
        except Exception:
            pass
        return None, None

    # CloudPanel accepts only lowercase letters and digits in a database or
    # database-user name, and caps both at 16 characters.
    DB_IDENTIFIER_MAX = 16

    def generate_db_credentials(self, domain: str):
        """Database name, user and password for a domain.

        The name has to be unique per domain, but CloudPanel's character rule
        means the domain's own separators cannot survive into it. Simply
        stripping them and truncating, which is what this did, made distinct
        domains land on the same name:

            testcrm.saraloms.com  -> testcrmsaralomsc
            test-crm.saraloms.com -> testcrmsaralomsc

        CloudPanel then rejected the second site with "This value already
        exists", naming a database the person deploying had never created.
        Truncation did the same to any two domains that first differ past the
        sixteenth character.

        So the readable part is kept short and a fingerprint of the whole
        domain -- punctuation included -- is appended. Domains that differ at
        all now get different names.
        """
        normalised = domain.strip().lower().rstrip('.')
        slug = re.sub(r'[^a-z0-9]', '', normalised)
        fingerprint = hashlib.sha1(normalised.encode('utf-8')).hexdigest()[:6]

        readable = slug[:self.DB_IDENTIFIER_MAX - len(fingerprint)]

        # MySQL wants an identifier that starts with a letter, and a domain may
        # legitimately start with a digit, as in 1crm.example.com.
        if not readable or readable[0].isdigit():
            readable = ('d' + readable)[:self.DB_IDENTIFIER_MAX - len(fingerprint)]

        safe_name = readable + fingerprint

        alphabet = string.ascii_letters + string.digits
        db_pass = ''.join(secrets.choice(alphabet) for i in range(16))

        return safe_name, safe_name, db_pass

    def _validated_db_identifier(self, value: str, field: str) -> str:
        """A database name or user typed into the deploy form, or an error
        somebody can act on.

        CloudPanel answers a bad one with "This value is not valid", which does
        not say which value or what was wrong with it.
        """
        candidate = value.strip()

        if not re.fullmatch(r'[a-z0-9]{1,%d}' % self.DB_IDENTIFIER_MAX, candidate):
            raise ValueError(
                f"{field} must be 1 to {self.DB_IDENTIFIER_MAX} characters using only "
                f"lowercase letters and digits (you gave '{value}'). "
                f"Leave it blank to have one generated from the domain."
            )

        return candidate

    def create_site(self, data: CloudPanelSiteCreate):
        """Non-streaming version — runs all steps and returns the final result."""
        result = {}
        for step_event in self.create_site_steps(data):
            result = step_event
        return result

    def create_site_steps(self, data: CloudPanelSiteCreate):
        """Generator that yields progress dicts for each deployment step.

        Each yield is: {"step": "step_id", "status": "done"|"skipped"|"error", ...}
        The final yield includes the full result with status "success".

        A step may also yield {"step": id, "status": "progress", "detail": text,
        "current": n, "total": m} while it is still running -- uploading files
        and importing the database take minutes, and the deploy screens show
        how far along they are instead of a spinner with nothing under it.
        current/total are left out where there is nothing to count.
        """
        db_name = data.dbName
        db_user = data.dbUser
        db_pass = data.dbPassword

        # Checked here rather than left to CloudPanel, which rejects a name
        # with a hyphen in it without saying so.
        if db_name:
            db_name = self._validated_db_identifier(db_name, "Database name")
        if db_user:
            db_user = self._validated_db_identifier(db_user, "Database user name")

        if not db_name or not db_user or not db_pass:
            gen_name, gen_user, gen_pass = self.generate_db_credentials(data.domainName)
            db_name = db_name or gen_name
            db_user = db_user or gen_user
            db_pass = db_pass or gen_pass

        # Generate system user and password for the new CloudPanel site.
        # CloudPanel always creates a new system user per site — we let it
        # manage user/path normally and deploy files to the htdocs it assigns.
        sys_user = data.sysUser or data.domainName.replace(".", "")[:16]
        sys_pass = data.sysUserPassword or ''.join(
            secrets.choice(string.ascii_letters + string.digits) for _ in range(16)
        )
        remote_dir = f"/home/{sys_user}/htdocs/{data.domainName}"

        # --- Step 1: Create site ---
        yield {"step": "creating_site", "status": "progress",
               "detail": f"Adding {data.domainName} on CloudPanel"}
        cmd_site = (
            f"clpctl site:add:php --domainName={data.domainName} "
            f"--phpVersion={data.phpVersion} --vhostTemplate={data.vhostTemplate} "
            f"--siteUser={sys_user} --siteUserPassword='{sys_pass}'"
        )
        self._execute(cmd_site)

        # Use the actual document root from the nginx vhost CloudPanel created,
        # so files always go where CloudPanel (and its file manager) expects them.
        try:
            vhost_root = self._execute(
                f"grep -m1 -oP 'root\\s+\\K[^;]+' /etc/nginx/sites-enabled/{data.domainName}.conf"
            ).strip()
            if vhost_root:
                remote_dir = vhost_root
                logger.info(f"Using document root from nginx: {remote_dir}")
        except Exception:
            logger.warning(f"Could not detect document root from nginx, using computed path: {remote_dir}")

        yield {"step": "creating_site", "status": "done"}

        # --- Step 2: Create SSL ---
        ssl_status = "skipped"
        sftp_ssl = self.client.open_sftp()
        try:
            if data.custom_ssl_cert and data.custom_ssl_key:
                logger.info("Installing Custom SSL...")
                cert_path = f"/tmp/{data.domainName}_cert.crt"
                key_path = f"/tmp/{data.domainName}_key.key"
                chain_path = f"/tmp/{data.domainName}_chain.crt"

                with sftp_ssl.open(cert_path, "w") as remote_f:
                    remote_f.write(data.custom_ssl_cert)
                with sftp_ssl.open(key_path, "w") as remote_f:
                    remote_f.write(data.custom_ssl_key)
                if data.custom_ssl_chain:
                    with sftp_ssl.open(chain_path, "w") as remote_f:
                        remote_f.write(data.custom_ssl_chain)

                chain_arg = f" --certificateChain={chain_path}" if data.custom_ssl_chain else ""
                cmd_ssl = f"clpctl site:install:certificate --domainName={data.domainName} --privateKey={key_path} --certificate={cert_path}{chain_arg}"
                self._execute(cmd_ssl)
                self._execute(f"rm -f {cert_path} {key_path} {chain_path}")
                ssl_status = "done"

            elif data.issue_ssl:
                logger.info("Issuing Let's Encrypt SSL...")
                yield {"step": "creating_ssl", "status": "progress",
                       "detail": "Asking Let's Encrypt for a certificate"}
                cmd_ssl = f"clpctl lets-encrypt:install:certificate --domainName={data.domainName}"
                if data.is_wildcard_ssl:
                    parts = data.domainName.split('.')
                    if len(parts) > 2:
                        root_domain = ".".join(parts[-2:])
                        cmd_ssl += f" --subjectAlternativeName=*.{root_domain}"
                self._execute(cmd_ssl)
                ssl_status = "done"
        except Exception as e:
            logger.error(f"SSL provisioning failed: {e}")
            ssl_status = "error"
        finally:
            sftp_ssl.close()

        yield {"step": "creating_ssl", "status": ssl_status}

        # --- Step 3: Create database (before file deployment) ---
        # clpctl db:add can reinitialize the site's htdocs directory on some
        # CloudPanel versions, wiping any files already deployed there.
        # Running it here — after site + SSL but before uploading files —
        # ensures CloudPanel finishes all its own initialization steps first.
        yield {"step": "creating_database", "status": "progress",
               "detail": f"Creating database {db_name}"}
        cmd_db = f"clpctl db:add --domainName={data.domainName} --databaseName={db_name} --databaseUserName={db_user} --databaseUserPassword='{db_pass}'"
        self._execute(cmd_db)

        # default.sql creates triggers, and it is loaded as the site's own
        # database user. With binary logging on (MySQL 8's default) such a
        # user may create a trigger only while log_bin_trust_function_creators
        # is 1; otherwise MySQL refuses with ERROR 1419 and the load stops
        # part way, leaving the site with a fraction of its tables. Asked
        # here, before anything is uploaded, so the person is told what to
        # change instead of getting a half-built site.
        out = self._execute(
            f"mysql -u {db_user} -p'{db_pass}' -N -B -e "
            "\"SELECT @@log_bin, @@log_bin_trust_function_creators\" 2>/dev/null || true"
        )
        flags = out.split()
        if len(flags) >= 2 and flags[0] == "1" and flags[1] == "0":
            raise Exception(
                "This server's MySQL has binary logging on and "
                "log_bin_trust_function_creators off, so the site's database "
                "user cannot create the triggers default.sql needs (ERROR 1419). "
                "Add log_bin_trust_function_creators = 1 under [mysqld] in the "
                "MySQL config and restart MySQL (or run SET GLOBAL "
                "log_bin_trust_function_creators = 1 as root), then create the "
                "site again. The site and its empty database were created; "
                "delete them first."
            )

        yield {"step": "creating_database", "status": "done"}

        # --- Step 4: Deploy template files ---
        sftp = self.client.open_sftp()
        template_name = data.templateName or "default_site"
        template_dir = os.path.join(os.path.dirname(__file__), "..", "..", "templates", template_name)
        self._execute(f"mkdir -p {remote_dir}")

        has_sql = False
        skip_dirs = {'__MACOSX'}
        skip_files = {'.DS_Store'}

        # Counted first so the screen can say "120 of 980" while uploading.
        total_files = 0
        if os.path.exists(template_dir):
            for _dp, _dn, _fn in os.walk(template_dir):
                _dn[:] = [d for d in _dn if d not in skip_dirs]
                total_files += sum(1 for f in _fn if f not in skip_files)
        sent_files = 0
        report_every = max(1, total_files // 50)
        yield {"step": "deploying_files", "status": "progress",
               "detail": f"Uploading {total_files} files", "current": 0, "total": total_files}

        if os.path.exists(template_dir):
            for dirpath, dirnames, filenames in os.walk(template_dir):
                dirnames[:] = [d for d in dirnames if d not in skip_dirs]
                rel_dir = os.path.relpath(dirpath, template_dir)
                if rel_dir == '.':
                    target_dir = remote_dir
                else:
                    target_dir = f"{remote_dir}/{rel_dir}"
                    self._execute(f"mkdir -p {target_dir}")

                for filename in filenames:
                    if filename in skip_files:
                        continue
                    local_path = os.path.join(dirpath, filename)
                    remote_path = f"{target_dir}/{filename}"

                    try:
                        with open(local_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        content = content.replace("[db_name]", db_name)
                        content = content.replace("[db_user]", db_user)
                        content = content.replace("[db_password]", db_pass)
                        content = content.replace("[email_from]", data.email_from or "")
                        with sftp.open(remote_path, "w") as remote_f:
                            remote_f.write(content)
                    except (UnicodeDecodeError, ValueError):
                        with open(local_path, "rb") as f:
                            raw = f.read()
                        with sftp.open(remote_path, "wb") as remote_f:
                            remote_f.write(raw)

                    if filename == "default.sql" and rel_dir == "database":
                        has_sql = True

                    sent_files += 1
                    if sent_files % report_every == 0 or sent_files == total_files:
                        yield {"step": "deploying_files", "status": "progress",
                               "detail": f"Uploaded {sent_files} of {total_files} files",
                               "current": sent_files, "total": total_files}

        sftp.close()

        yield {"step": "deploying_files", "status": "progress",
               "detail": "Setting file ownership", "current": total_files, "total": total_files}

        self._execute(f"chown -R {sys_user}:{sys_user} {remote_dir}")
        logger.info(f"Template files uploaded to {remote_dir}")
        try:
            listing = self._execute(f"ls -la {remote_dir}")
            logger.info(listing)
        except Exception:
            pass

        yield {"step": "deploying_files", "status": "done"}

        # --- Step 3c: Copy company logo if provided ---
        if data.company_logo_local_path and os.path.exists(data.company_logo_local_path):
            try:
                logo_ext = os.path.splitext(data.company_logo_local_path)[1] or ".png"
                remote_logo_dir = f"{remote_dir}/uploads/oms_company_info"
                self._execute(f"mkdir -p {remote_logo_dir}")
                remote_logo_path = f"{remote_logo_dir}/org_logo{logo_ext}"
                sftp_logo = self.client.open_sftp()
                sftp_logo.put(data.company_logo_local_path, remote_logo_path)
                sftp_logo.close()
                self._execute(f"chown {sys_user}:{sys_user} {remote_logo_path}")
                logger.info(f"Company logo copied to {remote_logo_path}")
                yield {"step": "copying_logo", "status": "done"}
            except Exception as e:
                logger.error(f"Failed to copy company logo: {e}")
                yield {"step": "copying_logo", "status": "error", "message": str(e)}
        else:
            yield {"step": "copying_logo", "status": "skipped"}

        # --- Step 3b: Run auto-run-script.sh if it exists ---
        script_path = f"{remote_dir}/auto-run-script.sh"
        try:
            self._execute(f"test -f {script_path}")
            # Replace placeholders in the script before running
            self._execute(f"sed -i 's/\\[user\\]/{sys_user}/g' {script_path}")
            self._execute(f"sed -i 's/\\[usergroup\\]/{sys_user}/g' {script_path}")
            self._execute(f"chmod +x {script_path}")
            yield {"step": "running_script", "status": "progress",
                   "detail": "Running auto-run-script.sh"}
            self._execute(f"cd {remote_dir} && bash {script_path}")
            yield {"step": "running_script", "status": "done"}
        except Exception:
            # Script does not exist — skip
            yield {"step": "running_script", "status": "skipped"}

        # --- Step 5: Import database ---
        if has_sql:
            # Listed before default.sql is loaded, so the count is known from
            # the start: default.sql is file 1 of (migrations + 1).
            migration_dir = f"{remote_dir}/database/migration"
            try:
                migration_output = self._execute(
                    f"find {migration_dir} -maxdepth 1 -name '*.sql' -type f 2>/dev/null | sort -V"
                )
                migration_files = [
                    f.strip() for f in migration_output.strip().splitlines()
                    if f.strip().endswith(".sql")
                ]
            except Exception as e:
                logger.info(f"No migration files or migration dir missing: {e}")
                migration_files = []
            total_sql = len(migration_files) + 1

            sql_path = f"{remote_dir}/database/default.sql"
            yield {"step": "importing_database", "status": "progress",
                   "detail": "Loading default.sql", "current": 0, "total": total_sql}
            cmd_import = f"mysql -u {db_user} -p'{db_pass}' {db_name} < {sql_path}"
            self._execute(cmd_import)

            # Import migration files in ascending filename order
            try:
                for i, mf in enumerate(migration_files, start=1):
                    yield {"step": "importing_database", "status": "progress",
                           "detail": f"Running {os.path.basename(mf)} ({i} of {len(migration_files)})",
                           "current": i, "total": total_sql}
                    self._execute(f"mysql -u {db_user} -p'{db_pass}' {db_name} < {mf}")
                    logger.info(f"Imported migration: {mf}")
            except Exception as e:
                logger.info(f"Migration import stopped: {e}")

            yield {"step": "importing_database", "status": "done"}
        else:
            yield {"step": "importing_database", "status": "skipped"}

        # Final result
        yield {
            "step": "complete",
            "status": "success",
            "domain": data.domainName,
            "db_name": db_name,
            "db_user": db_user,
            "db_password": db_pass,
            "sys_user": sys_user,
            "sys_password": sys_pass
        }

    def get_ssl_report(self):
        # find all certificates in nginx ssl directory and get their expiration date
        cmd = 'find /etc/nginx/ssl-certificates -name "*.crt" -type f -exec sh -c \'echo "$1"; openssl x509 -enddate -noout -in "$1"\' _ {} \;'
        try:
            raw_out = self._execute(cmd)
            lines = raw_out.strip().split('\n')
            report = []
            
            # Lines are staggered:
            # /etc/nginx/ssl-certificates/domain.com.crt
            # notAfter=May 20 12:00:00 2025 GMT
            current_domain = None
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                if line.startswith('/etc/nginx/ssl-certificates/'):
                    # extract domain name
                    filename = os.path.basename(line)
                    current_domain = filename.replace('.crt', '')
                elif line.startswith('notAfter=') and current_domain:
                    # parse date format like 'notAfter=May 20 12:00:00 2025 GMT'
                    expiry_date_str = line.split('notAfter=')[1]
                    report.append({
                        "domain": current_domain,
                        "expiry": expiry_date_str
                    })
                    current_domain = None
                    
            return report
        except Exception as e:
            logger.error(f"Failed to get SSL report: {e}")
            return []

    def renew_ssl(self, domain: str):
        logger.info(f"Renewing SSL for {domain}")
        # To renew, simply reinstalling Let's encrypt certificate will renew it in cloudpanel
        cmd_ssl = f"clpctl lets-encrypt:install:certificate --domainName={domain}"
        output = self._execute(cmd_ssl)
        return output

