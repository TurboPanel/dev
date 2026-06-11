# TurboPanel local dev — Cloudflare Workers (pnpm/wrangler) behind Caddy.
# Run `tilt up` from the dev/ checkout; `tilt down` tears down Docker resources.

load('ext://dotenv', 'dotenv')

dev_root = config.main_dir
install_root = os.path.dirname(dev_root)
instance_dir = os.path.join(install_root, 'instance')
ui_dir = os.path.join(install_root, 'ui')
website_dir = os.path.join(install_root, 'website')
env_file = os.path.join(dev_root, '.env')
env_example = os.path.join(dev_root, '.env.example')
sync_env = os.path.join(dev_root, 'scripts', 'sync-env.sh')
caddyfile = os.path.join(dev_root, 'docker', 'Caddyfile')

_PACKAGE_JSON = 'package.json'
_PNPM_LOCK = 'pnpm-lock.yaml'
_PNPM_INSTALL = 'pnpm install'

if not os.path.exists(instance_dir):
  fail('instance checkout not found at %s — run pull.sh first' % instance_dir)

if not os.path.exists(ui_dir):
  fail('ui checkout not found at %s — run pull.sh first' % ui_dir)

if not os.path.exists(website_dir):
  fail('website checkout not found at %s — run pull.sh first' % website_dir)

if not os.path.exists(env_file):
  fail('.env missing — copy %s to %s and edit as needed' % (env_example, env_file))

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

local_resource(
  'env-sync',
  cmd='bash %s' % sync_env,
  deps=[env_file, sync_env],
  labels=['config'],
)

docker_compose([
  'docker/postgres.compose.yml',
  'docker/caddy.compose.yml',
])
dc_resource('postgres', resource_deps=['env-sync'], labels=['database'])
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
  'dev-urls',
  cmd='''cat <<EOF
TurboPanel dev URLs

  App         https://127.0.0.1:%s
  Website     http://127.0.0.1:%s
  Docs        http://127.0.0.1:%s/docs
  API health  https://127.0.0.1:%s/api/health
  Postgres    127.0.0.1:%s
  Tilt UI     http://127.0.0.1:10350
EOF''' % (_caddy_port, _website_port, _website_port, _caddy_port, _pg_port),
  resource_deps=['caddy', 'postgres'],
  labels=['config'],
)

local_resource(
  'instance-certs',
  cmd='pnpm cert:generate',
  dir=instance_dir,
  resource_deps=['env-sync', 'instance-deps'],
  deps=[
    env_file,
    os.path.join(instance_dir, 'scripts', 'generate-self-signed-cert.mjs'),
  ],
  labels=['proxy'],
)

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
  serve_cmd='pnpm dev',
  serve_dir=instance_dir,
  resource_deps=['instance-db', 'env-sync'],
  deps=[
    os.path.join(instance_dir, 'src'),
    os.path.join(instance_dir, 'wrangler.jsonc'),
    os.path.join(instance_dir, _PACKAGE_JSON),
    os.path.join(instance_dir, '.dev.vars'),
    os.path.join(instance_dir, '.env'),
  ],
  labels=['instance'],
)

local_resource(
  'ui',
  serve_cmd='pnpm web -- --port %s' % _expo_port,
  serve_dir=ui_dir,
  resource_deps=['ui-deps'],
  deps=[os.path.join(ui_dir, 'src')],
  labels=['ui'],
)

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
  serve_cmd='NEXT_PUBLIC_WEBSITE_PORT=%s NEXT_PUBLIC_CADDY_PORT=%s pnpm dev --port %s' % (_website_port, _caddy_port, _website_port),
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
  labels=['website'],
)
