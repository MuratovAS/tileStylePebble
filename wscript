#
# This file is the default set of rules to compile a Pebble application.
#
# Feel free to customize this to your needs.
#
import json
import os.path

top = '.'
out = 'build'

# Settings page on GitHub Pages: the gh-pages branch keeps a snapshot of
# config/ per release in vX.Y.Z/
CONFIG_BASE_URL = 'https://muratovas.github.io/tileStylePebble/'
# package.json version of builds made outside the release workflow
LOCAL_VERSION = '0.0.0'


def config_url(ctx):
    """The settings page this build opens. Release builds (the release
    workflow stamps the tag's version into package.json) open their snapshot
    on GitHub Pages; local builds (version 0.0.0, as committed) open config/
    of this checkout, which works in the emulator (pebble emu-app-config).
    CONFIG_URL=http://<host>:<port>/ pebble build opens that page instead,
    e.g. config/ served from this machine for a real phone."""
    if os.environ.get('CONFIG_URL'):
        return os.environ['CONFIG_URL']
    with open(ctx.path.find_node('package.json').abspath()) as f:
        version = json.load(f)['version']
    if version == LOCAL_VERSION:
        return 'file://' + ctx.path.find_node('config/index.html').abspath()
    return CONFIG_BASE_URL + 'v' + version + '/'


def write_build_info(task):
    """build/js/build_info.json, read by src/pkjs/index.js as require('build_info')"""
    task.outputs[0].write(json.dumps({'configUrl': task.env.CONFIG_URL}) + '\n')


def options(ctx):
    ctx.load('pebble_sdk')


def configure(ctx):
    """
    This method is used to configure your build. ctx.load(`pebble_sdk`) automatically configures
    a build for each valid platform in `targetPlatforms`. Platform-specific configuration: add your
    change after calling ctx.load('pebble_sdk') and make sure to set the correct environment first.
    Universal configuration: add your change prior to calling ctx.load('pebble_sdk').
    """
    ctx.load('pebble_sdk')


def build(ctx):
    ctx.load('pebble_sdk')

    build_worker = os.path.exists('worker_src')
    binaries = []

    cached_env = ctx.env
    for platform in ctx.env.TARGET_PLATFORMS:
        ctx.env = ctx.all_envs[platform]
        ctx.set_group(ctx.env.PLATFORM_NAME)
        app_elf = '{}/pebble-app.elf'.format(ctx.env.BUILD_DIR)
        defines = []
        # DEMO=1 pebble build: MOCK data of the settings page preview instead
        # of real data; DEMO_TIME=<unix seconds> also freezes the clock
        if os.environ.get('DEMO'):
            defines.append('DEMO_DATA')
        if os.environ.get('DEMO_TIME'):
            defines.append('DEMO_TIME=%d' % int(os.environ['DEMO_TIME']))
        ctx.pbl_build(source=ctx.path.ant_glob('src/c/**/*.c'), target=app_elf, bin_type='app', defines=defines)

        if build_worker:
            worker_elf = '{}/pebble-worker.elf'.format(ctx.env.BUILD_DIR)
            binaries.append({'platform': platform, 'app_elf': app_elf, 'worker_elf': worker_elf})
            ctx.pbl_build(source=ctx.path.ant_glob('worker_src/c/**/*.c'),
                          target=worker_elf,
                          bin_type='worker')
        else:
            binaries.append({'platform': platform, 'app_elf': app_elf})
    ctx.env = cached_env

    ctx.set_group('bundle')
    # build/js is on the JS module path, as for the SDK's message_keys.json;
    # vars makes a new CONFIG_VERSION rewrite the file
    ctx.env.CONFIG_URL = config_url(ctx)
    build_info = ctx.path.get_bld().make_node('js/build_info.json')
    ctx(rule=write_build_info, target=build_info, vars=['CONFIG_URL'])
    ctx.pbl_bundle(binaries=binaries,
                   js=ctx.path.ant_glob(['src/pkjs/**/*.js',
                                         'src/pkjs/**/*.json',
                                         'src/common/**/*.js']) + [build_info],
                   js_entry_file='src/pkjs/index.js')
