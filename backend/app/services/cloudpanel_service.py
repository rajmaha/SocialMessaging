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
        safe_name = domain.replace(".", "_")
        safe_name = safe_name[:64]
        
        db_name = safe_name
        db_user = safe_name
        
        alphabet = string.ascii_letters + string.digits
        db_pass = ''.join(secrets.choice(alphabet) for i in range(16))
        
        return db_name, db_user, db_pass

    def create_site(self, data: CloudPanelSiteCreate):
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

        cmd_site = f"clpctl site:add:php --domainName={data.domainName} --phpVersion={data.phpVersion} --vhostTemplate={data.vhostTemplate} --sysUser={sys_user} --sysUserPassword='{sys_pass}'"
        self._execute(cmd_site)

        cmd_db = f"clpctl db:add --domainName={data.domainName} --databaseName={db_name} --databaseUserName={db_user} --databaseUserPassword='{db_pass}'"
        self._execute(cmd_db)

        sftp = self.client.open_sftp()
        template_dir = os.path.join(os.path.dirname(__file__), "..", "..", "templates", "default_site")
        remote_dir = f"/home/{sys_user}/htdocs/{data.domainName}"
        
        has_sql = False
        if os.path.exists(template_dir):
            for filename in os.listdir(template_dir):
                local_path = os.path.join(template_dir, filename)
                if os.path.isfile(local_path):
                    with open(local_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    
                    content = content.replace("[db_name]", db_name)
                    content = content.replace("[db_user]", db_user)
                    content = content.replace("[db_password]", db_pass)
                    
                    remote_path = f"{remote_dir}/{filename}"
                    with sftp.open(remote_path, "w") as remote_f:
                        remote_f.write(content)
                        
                    if filename == "default.sql":
                        has_sql = True
                        
        sftp.close()
        
        self._execute(f"chown -R {sys_user}:{sys_user} {remote_dir}")

        if has_sql:
            sql_path = f"{remote_dir}/default.sql"
            cmd_import = f"mysql -u {db_user} -p'{db_pass}' {db_name} < {sql_path}"
            self._execute(cmd_import)

        # Handle SSL
        sftp = self.client.open_sftp()
        try:
            if data.custom_ssl_cert and data.custom_ssl_key:
                logger.info("Installing Custom SSL...")
                cert_path = f"/tmp/{data.domainName}_cert.crt"
                key_path = f"/tmp/{data.domainName}_key.key"
                chain_path = f"/tmp/{data.domainName}_chain.crt"
                
                with sftp.open(cert_path, "w") as remote_f:
                    remote_f.write(data.custom_ssl_cert)
                with sftp.open(key_path, "w") as remote_f:
                    remote_f.write(data.custom_ssl_key)
                if data.custom_ssl_chain:
                    with sftp.open(chain_path, "w") as remote_f:
                        remote_f.write(data.custom_ssl_chain)
                
                chain_arg = f" --certificateChain={chain_path}" if data.custom_ssl_chain else ""
                cmd_ssl = f"clpctl site:install:certificate --domainName={data.domainName} --privateKey={key_path} --certificate={cert_path}{chain_arg}"
                self._execute(cmd_ssl)
                
                # Cleanup temp
                self._execute(f"rm -f {cert_path} {key_path} {chain_path}")
            
            elif data.issue_ssl:
                logger.info("Issuing Let's Encrypt SSL...")
                cmd_ssl = f"clpctl lets-encrypt:install:certificate --domainName={data.domainName}"
                if data.is_wildcard_ssl:
                    # Assumes a subdomain is used and cloudpanel DNS is setup. Fallback to just parsing root domain
                    parts = data.domainName.split('.')
                    if len(parts) > 2:
                        root_domain = ".".join(parts[-2:])
                        cmd_ssl += f" --subjectAlternativeName=*.{root_domain}"
                self._execute(cmd_ssl)
        except Exception as e:
            logger.error(f"SSL provisioning failed: {e}")
            # we do not fail the whole site creation just because SSL failed
        finally:
            sftp.close()

        return {
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

