# TurboPanel local dev — Workers (wrangler) or Deno instance behind Caddy.
# Run `tilt up` from the dev/ checkout; `tilt down` tears down Docker resources.

load('ext://dotenv', 'dotenv')
load('ext://uibutton', 'cmd_button', 'location')

dev_root = config.main_dir
install_root = os.path.dirname(dev_root)
instance_dir = os.path.join(install_root, 'instance')
ui_dir = os.path.join(install_root, 'ui')
website_dir = os.path.join(install_root, 'website')
daemon_dir = os.path.join(install_root, 'daemon')
env_file = os.path.join(dev_root, '.env')
env_example = os.path.join(dev_root, '.env.example')
init_env = os.path.join(dev_root, 'scripts', 'init-env.mjs')
sync_env = os.path.join(dev_root, 'scripts', 'sync-env.sh')
caddyfile = os.path.join(dev_root, 'docker', 'Caddyfile')

_PACKAGE_JSON = 'package.json'
_PNPM_LOCK = 'pnpm-lock.yaml'
_ensure_pnpm = os.path.join(dev_root, 'scripts', 'ensure-pnpm.sh')
_PNPM_INSTALL = 'bash %s install' % _ensure_pnpm

if not os.path.exists(instance_dir):
  fail('instance checkout not found at %s — run pull.sh first' % instance_dir)

if not os.path.exists(ui_dir):
  fail('ui checkout not found at %s — run pull.sh first' % ui_dir)

if not os.path.exists(website_dir):
  fail('website checkout not found at %s — run pull.sh first' % website_dir)

if not os.path.exists(daemon_dir):
  fail('daemon checkout not found at %s — run pull.sh first' % daemon_dir)

local('node "%s"' % init_env)

dotenv(fn=os.path.join(dev_root, '.env'))

def env(name, default=''):
  return os.getenv(name, default) or default

_pg_user = env('POSTGRES_USER', 'turbopanel')
_pg_pass = env('POSTGRES_PASSWORD', 'turbopanel-dev')
_pg_db = env('POSTGRES_DB', 'turbopanel')
_pg_host = env('POSTGRES_HOST', '127.0.0.1')
_pg_port = env('POSTGRES_PORT', '5432')
_dev_pg_url = 'postgresql://%s:%s@%s:%s/%s' % (_pg_user, _pg_pass, _pg_host, _pg_port, _pg_db)

_caddy_port = env('CADDY_PORT', '8443')
_instance_port = env('INSTANCE_DEV_PORT', '18787')
_expo_port = env('EXPO_PORT', '8081')
_website_port = env('WEBSITE_PORT', '19820')
_mailpit_smtp_port = env('MAILPIT_SMTP_PORT', '19825')
_mailpit_web_port  = env('MAILPIT_WEB_PORT',  '19826')
_rabbitmq_amqp_port = env('RABBITMQ_AMQP_PORT', '19828')
_rabbitmq_mgmt_port = env('RABBITMQ_MGMT_PORT', '19833')
_instance_runtime = env('TURBOPANEL_INSTANCE_RUNTIME', 'workers').lower()
if _instance_runtime not in ('workers', 'deno'):
  fail('TURBOPANEL_INSTANCE_RUNTIME must be workers or deno (got %s)' % _instance_runtime)

_switch_runtime = 'deno' if _instance_runtime == 'workers' else 'workers'
_switch_label = 'Switch to Deno Mode' if _switch_runtime == 'deno' else 'Switch to Workers Mode'
_switch_icon = 'dns' if _switch_runtime == 'deno' else 'cloud_queue'

# Core product services — grouped at the top of the Tilt UI (labels sort alphabetically).
_PLATFORM = '1_platform'

local_resource(
  'env-sync',
  cmd='bash %s' % sync_env,
  deps=[env_file, env_example, init_env, sync_env],
  labels=['config'],
)

docker_compose([
  'docker/postgres.compose.yml',
  'docker/caddy.compose.yml',
])

local_resource(
  'instance-deps',
  cmd=_PNPM_INSTALL,
  dir=instance_dir,
  resource_deps=['env-sync'],
  deps=[
    os.path.join(instance_dir, _PACKAGE_JSON),
    os.path.join(instance_dir, _PNPM_LOCK),
  ],
  labels=['install'],
)

local_resource(
  'instance-certs',
  cmd='bash %s cert:generate' % _ensure_pnpm,
  dir=instance_dir,
  resource_deps=['env-sync', 'instance-deps'],
  deps=[
    env_file,
    os.path.join(instance_dir, 'scripts', 'generate-self-signed-cert.mjs'),
  ],
  labels=['proxy'],
)

dc_resource('postgres', resource_deps=['env-sync'], labels=['database'])

local_resource(
  'instance-db',
  cmd='set -a && . ./.env && set +a && ./sync.sh --force',
  dir=instance_dir,
  resource_deps=['postgres', 'instance-deps', 'env-sync'],
  deps=[
    os.path.join(instance_dir, 'src/db/schema.ts'),
    os.path.join(instance_dir, '.env'),
  ],
  labels=['instance'],
)

local_resource(
  'instance',
  serve_cmd='bash %s' % os.path.join(dev_root, 'scripts', 'instance-serve.sh'),
  serve_dir=instance_dir,
  resource_deps=['instance-db', 'env-sync'],
  deps=[
    os.path.join(instance_dir, 'src'),
    os.path.join(instance_dir, 'wrangler.jsonc'),
    os.path.join(instance_dir, _PACKAGE_JSON),
    os.path.join(instance_dir, '.dev.vars'),
    os.path.join(instance_dir, '.env'),
    env_file,
    os.path.join(dev_root, 'scripts', 'instance-serve.sh'),
  ],
  labels=[_PLATFORM],
)

local_resource(
  'ui-deps',
  cmd=_PNPM_INSTALL,
  dir=ui_dir,
  resource_deps=['env-sync'],
  deps=[
    os.path.join(ui_dir, _PACKAGE_JSON),
    os.path.join(ui_dir, _PNPM_LOCK),
  ],
  labels=['install'],
)

local_resource(
  'ui',
  serve_cmd='bash %s web -- --port %s' % (_ensure_pnpm, _expo_port),
  serve_dir=ui_dir,
  resource_deps=['ui-deps'],
  deps=[os.path.join(ui_dir, 'src')],
  labels=[_PLATFORM],
)

local_resource(
  'mailpit',
  serve_cmd='bash %s %s %s' % (
    os.path.join(dev_root, 'scripts', 'mailpit-serve.sh'),
    _mailpit_smtp_port,
    _mailpit_web_port,
  ),
  resource_deps=['env-sync'],
  links=[link('http://localhost:%s' % _mailpit_web_port, 'mailpit')],
  labels=['email'],
)

local_resource(
  'rabbitmq',
  serve_cmd='bash %s %s %s' % (
    os.path.join(dev_root, 'scripts', 'rabbitmq-serve.sh'),
    _rabbitmq_amqp_port,
    _rabbitmq_mgmt_port,
  ),
  resource_deps=['env-sync'],
  links=[link('http://localhost:%s' % _rabbitmq_mgmt_port, 'rabbitmq')],
  labels=['email'],
)

if _instance_runtime == 'deno':
  local_resource(
    'mailer',
    serve_cmd='bash %s' % os.path.join(dev_root, 'scripts', 'mailer-serve.sh'),
    serve_dir=instance_dir,
    resource_deps=['rabbitmq', 'instance-db', 'env-sync'],
    deps=[
      os.path.join(instance_dir, 'mailer'),
      os.path.join(instance_dir, 'src', 'email'),
      os.path.join(dev_root, 'scripts', 'mailer-serve.sh'),
    ],
    labels=['email'],
  )

dc_resource(
  'caddy',
  resource_deps=['env-sync', 'instance-certs', 'instance', 'ui'],
  links=[
    link('https://localhost:%s' % _caddy_port, 'app'),
    link('https://localhost:%s/api/health' % _caddy_port, 'health'),
  ],
  labels=['proxy'],
)

local_resource(
  'daemon',
  serve_cmd='bash %s' % os.path.join(dev_root, 'scripts', 'daemon-serve.sh'),
  serve_dir=daemon_dir,
  resource_deps=['instance', 'caddy', 'instance-certs', 'env-sync'],
  deps=[
    os.path.join(daemon_dir, 'src'),
    os.path.join(daemon_dir, 'main.ts'),
    os.path.join(daemon_dir, 'deno.json'),
    env_file,
    os.path.join(dev_root, 'scripts', 'daemon-serve.sh'),
    os.path.join(instance_dir, 'certs', 'ca.crt'),
  ],
  labels=[_PLATFORM],
)

_dev_urls_deps = ['caddy', 'postgres', 'mailpit', 'rabbitmq', 'daemon']
if _instance_runtime == 'deno':
  _dev_urls_deps.append('mailer')

local_resource(
  'dev-urls',
  cmd='''cat <<EOF
TurboPanel dev URLs (instance runtime: %s)

  App         https://localhost:%s
  Website     http://localhost:%s
  Docs        http://localhost:%s/docs
  API health  https://localhost:%s/api/health
  Mailpit     http://localhost:%s
  RabbitMQ    http://localhost:%s
  Postgres    localhost:%s
  Tilt UI     http://localhost:10350
EOF''' % (_instance_runtime, _caddy_port, _website_port, _website_port, _caddy_port, _mailpit_web_port, _rabbitmq_mgmt_port, _pg_port),
  resource_deps=_dev_urls_deps,
  labels=['config'],
)

cmd_button(
  'switch-instance-runtime',
  argv=['bash', os.path.join(dev_root, 'scripts', 'switch-runtime.sh'), _switch_runtime],
  location=location.NAV,
  icon_name=_switch_icon,
  text=_switch_label,
)

local_resource(
  'website-deps',
  cmd=_PNPM_INSTALL,
  dir=website_dir,
  resource_deps=['env-sync'],
  deps=[
    os.path.join(website_dir, _PACKAGE_JSON),
    os.path.join(website_dir, _PNPM_LOCK),
  ],
  labels=['install'],
)

local_resource(
  'website',
  serve_cmd='NEXT_PUBLIC_WEBSITE_PORT=%s NEXT_PUBLIC_CADDY_PORT=%s bash %s dev --port %s' % (_website_port, _caddy_port, _ensure_pnpm, _website_port),
  serve_dir=website_dir,
  resource_deps=['website-deps', 'instance'],
  deps=[
    os.path.join(website_dir, 'src'),
    os.path.join(website_dir, 'docs'),
    os.path.join(website_dir, _PACKAGE_JSON),
  ],
  links=[
    link('http://localhost:%s' % _website_port, 'website'),
    link('http://localhost:%s/docs' % _website_port, 'docs'),
    link('http://localhost:%s/docs/api' % _website_port, 'api reference'),
    link('http://localhost:%s/api/reference' % _website_port, 'scalar (direct)'),
  ],
  labels=[_PLATFORM],
)
