import paramiko
import os
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
            pkey = paramiko.RSAKey.from_private_key(StringIO(self.server.ssh_key))
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

    def generate_db_credentials(self, domain: str):
        import re
        # CloudPanel requires purely lowercase alphanumeric DB names
        # e.g. demo-4u.net → demo4unet, app.demo-4u.net → appdemo4unet
        safe_name = re.sub(r'[^a-zA-Z0-9]', '', domain).lower()
        safe_name = safe_name[:16]

        db_name = safe_name
        db_user = safe_name
        
        alphabet = string.ascii_letters + string.digits
        db_pass = ''.join(secrets.choice(alphabet) for i in range(16))
        
        return db_name, db_user, db_pass

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
        """
        db_name = data.dbName
        db_user = data.dbUser
        db_pass = data.dbPassword

        if not db_name or not db_user or not db_pass:
            gen_name, gen_user, gen_pass = self.generate_db_credentials(data.domainName)
            db_name = db_name or gen_name
            db_user = db_user or gen_user
            db_pass = db_pass or gen_pass

        sys_user = data.sysUser or data.domainName.replace(".", "")[:16]
        sys_pass = data.sysUserPassword or ''.join(secrets.choice(string.ascii_letters + string.digits) for i in range(16))

        # Determine remote directory and document root based on whether it's a subdomain
        parts = data.domainName.split('.')
        is_subdomain = len(parts) > 2

        if is_subdomain:
            root_domain = ".".join(parts[-2:])
            subdomain_part = ".".join(parts[:-2])
            remote_dir = f"/home/{sys_user}/htdocs/{root_domain}/public/{subdomain_part}"
        else:
            remote_dir = f"/home/{sys_user}/htdocs/{data.domainName}"

        # --- Step 1: Create site ---
        cmd_site = f"clpctl site:add:php --domainName={data.domainName} --phpVersion={data.phpVersion} --vhostTemplate={data.vhostTemplate} --siteUser={sys_user} --siteUserPassword='{sys_pass}'"
        self._execute(cmd_site)

        # Get the actual document root from the nginx vhost CloudPanel created
        try:
            vhost_root = self._execute(
                f"grep -m1 -oP 'root\\s+\\K[^;]+' /etc/nginx/sites-enabled/{data.domainName}.conf"
            ).strip()
            if vhost_root:
                remote_dir = vhost_root
                logger.info(f"Detected document root from nginx: {remote_dir}")
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

        # --- Step 3: Deploy template files ---
        sftp = self.client.open_sftp()
        template_name = data.templateName or "default_site"
        template_dir = os.path.join(os.path.dirname(__file__), "..", "..", "templates", template_name)
        self._execute(f"mkdir -p {remote_dir}")

        has_sql = False
        skip_dirs = {'__MACOSX'}
        skip_files = {'.DS_Store'}

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
                        with sftp.open(remote_path, "w") as remote_f:
                            remote_f.write(content)
                    except (UnicodeDecodeError, ValueError):
                        with open(local_path, "rb") as f:
                            raw = f.read()
                        with sftp.open(remote_path, "wb") as remote_f:
                            remote_f.write(raw)

                    if filename == "default.sql":
                        has_sql = True

        sftp.close()

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
            self._execute(f"cd {remote_dir} && bash {script_path}")
            yield {"step": "running_script", "status": "done"}
        except Exception:
            # Script does not exist — skip
            yield {"step": "running_script", "status": "skipped"}

        # --- Step 4: Create database ---
        cmd_db = f"clpctl db:add --domainName={data.domainName} --databaseName={db_name} --databaseUserName={db_user} --databaseUserPassword='{db_pass}'"
        self._execute(cmd_db)

        yield {"step": "creating_database", "status": "done"}

        # --- Step 5: Import database ---
        if has_sql:
            sql_path = f"{remote_dir}/default.sql"
            cmd_import = f"mysql -u {db_user} -p'{db_pass}' {db_name} < {sql_path}"
            self._execute(cmd_import)
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

