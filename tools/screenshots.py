"""
Takes the app store screenshots: built-in layouts on the emery emulator,
with the demo data of the settings page and the clock at 10:10.

    python3 tools/screenshots.py [preset key ...]

Builds the watchface with DEMO=1 (the page's MOCK data instead of real
data, see wscript), installs it on the emulator, sends each layout and saves
screenshots/emery_<n>_<key>.png with the store's colour correction, as
`pebble screenshot` does; then builds the normal watchface again. The file
names start with the platform, as `pebble publish --screenshots` expects.
"""
import datetime
import glob
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'screenshots')
PLATFORM = 'emery'
SHOTS = ['timestyle', 'lime', 'dashboard', 'neon', 'sport', 'world']


def run(*cmd, env=None):
    subprocess.run(cmd, cwd=ROOT, check=True, env=env, stdout=subprocess.DEVNULL)


def build(demo_time=None):
    env = dict(os.environ)
    env.pop('DEMO', None)
    env.pop('DEMO_TIME', None)
    if demo_time:
        env.update(DEMO='1', DEMO_TIME=str(demo_time))
    # waf does not see a changed environment
    for f in glob.glob(os.path.join(ROOT, 'src', 'c', '*.c')):
        os.utime(f)
    run('pebble', 'build', env=env)


def main(keys):
    keys = keys or SHOTS
    demo_time = int(time.mktime(datetime.datetime.now().replace(hour=10, minute=10, second=0).timetuple()))
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, PLATFORM + '_*.png')):
        os.remove(old)
    build(demo_time)
    try:
        run('pebble', 'install', '--emulator', PLATFORM)
        time.sleep(3)
        for n, key in enumerate(keys, 1):
            run(sys.executable, os.path.join(ROOT, 'tools', 'send_appmessage.py'), '--preset', key)
            time.sleep(2)
            path = os.path.join(OUT, '%s_%d_%s.png' % (PLATFORM, n, key))
            run('pebble', 'screenshot', '--emulator', PLATFORM, '--no-open', path)
            print('wrote ' + os.path.relpath(path, ROOT))
    finally:
        build()


if __name__ == '__main__':
    main(sys.argv[1:])
