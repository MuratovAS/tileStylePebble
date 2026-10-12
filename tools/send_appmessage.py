#!/usr/bin/env python3
"""Send Config / Weather blobs (src/c/protocol.h) to the running emulator.

Talks to the emulator through its pypkjs websocket (the same way the
`pebble` tool does) with libpebble2 from the pebble tool's Python
environment; the script re-runs itself under that interpreter if needed.
The TileStyle watchface must be the running app on the emulator.

Blobs come from hex strings, or are encoded with tools/encode_config.js:

  python3 tools/send_appmessage.py --preset timestyle --demo-weather
  python3 tools/send_appmessage.py --config settings.json --weather weather.json
  python3 tools/send_appmessage.py --config-hex 0107... --weather-hex 01...
  python3 tools/send_appmessage.py --live-weather 55.75,37.62
  python3 tools/send_appmessage.py --listen 30        # print watch -> phone messages

Message key ids are read from the build output (build/js/message_keys.json,
build/appinfo.json or the .pbw), the app UUID from package.json.
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ENCODER = os.path.join(ROOT, 'tools', 'encode_config.js')


def ensure_libpebble2():
    try:
        import libpebble2  # noqa: F401
        return
    except ImportError:
        pass
    if os.environ.get('TILESTYLE_REEXEC'):
        sys.exit('libpebble2 not found, even in the pebble tool environment')
    pebble = shutil.which('pebble')
    if not pebble:
        sys.exit('libpebble2 not importable and the pebble tool is not on PATH')
    with open(os.path.realpath(pebble), 'rb') as f:
        first = f.readline().decode('utf-8', 'replace').strip()
    if not first.startswith('#!'):
        sys.exit('cannot find the pebble tool interpreter (no shebang in %s)' % pebble)
    interp = first[2:].strip().split()
    os.environ['TILESTYLE_REEXEC'] = '1'
    os.execv(interp[0], interp + [os.path.abspath(__file__)] + sys.argv[1:])


def load_message_keys(build_dir):
    candidates = [os.path.join(build_dir, 'js', 'message_keys.json')]
    for path in candidates:
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f), path
    path = os.path.join(build_dir, 'appinfo.json')
    if os.path.exists(path):
        with open(path) as f:
            info = json.load(f)
        keys = info.get('messageKeys') or info.get('appKeys')
        if isinstance(keys, dict):
            return keys, path
    for pbw in sorted(glob.glob(os.path.join(build_dir, '*.pbw'))):
        with zipfile.ZipFile(pbw) as z:
            info = json.loads(z.read('appinfo.json'))
        keys = info.get('messageKeys') or info.get('appKeys')
        if isinstance(keys, dict):
            return keys, pbw
    sys.exit('no message keys in %s: run `pebble build` first' % build_dir)


def load_uuid():
    with open(os.path.join(ROOT, 'package.json')) as f:
        return uuid.UUID(json.load(f)['pebble']['uuid'])


def emulator_ws(platform):
    info_path = os.path.join(tempfile.gettempdir(), 'pb-emulator.json')
    try:
        with open(info_path) as f:
            info = json.load(f)
    except (IOError, ValueError):
        info = {}
    versions = info.get(platform) or {}
    for version in sorted(versions, reverse=True):
        pypkjs = versions[version].get('pypkjs') or {}
        pid, port = pypkjs.get('pid'), pypkjs.get('port')
        if port and pid:
            try:
                os.kill(pid, 0)
            except OSError:
                continue
            return 'ws://localhost:%d/' % port
    sys.exit('no running %s emulator (see %s); start one with `pebble install --emulator %s`'
             % (platform, info_path, platform))


def encode_with_node(args):
    cmd = ['node', ENCODER, '--json']
    if args.preset:
        cmd += ['--preset', args.preset]
    elif args.config:
        cmd += [args.config]
    if args.weather:
        cmd += ['--weather', args.weather]
    elif args.demo_weather:
        cmd += ['--demo-weather']
    elif args.live_weather:
        cmd += ['--live-weather', args.live_weather]
    if len(cmd) == 3:
        return {}
    out = subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout
    return json.loads(out.decode('utf-8'))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--config-hex', help='settings blob as hex')
    p.add_argument('--weather-hex', help='weather blob as hex')
    p.add_argument('--config', metavar='JSON', help='settings JSON file (encoded with node)')
    p.add_argument('--preset', metavar='KEY', help='settings of a built-in preset (key or index)')
    p.add_argument('--weather', metavar='JSON', help='weather JSON file (normalized or raw Open-Meteo)')
    p.add_argument('--demo-weather', action='store_true', help='synthetic weather')
    p.add_argument('--live-weather', metavar='LAT,LON', help='fetch weather from Open-Meteo now')
    p.add_argument('--listen', type=float, default=0, metavar='SEC',
                   help='after sending, print messages from the watch for SEC seconds')
    p.add_argument('--platform', default='emery')
    p.add_argument('--ws', help='pypkjs websocket URL (default: the running emulator)')
    p.add_argument('--build-dir', default=os.path.join(ROOT, 'build'))
    p.add_argument('--timeout', type=float, default=10)
    args = p.parse_args()

    blobs = []  # (key name, bytes)
    encoded = encode_with_node(args)
    config_hex = args.config_hex or encoded.get('config')
    weather_hex = args.weather_hex or encoded.get('weather')
    if config_hex:
        blobs.append(('Config', bytes.fromhex(config_hex)))
    if weather_hex:
        blobs.append(('Weather', bytes.fromhex(weather_hex)))
    if not blobs and not args.listen:
        p.error('nothing to send')

    ensure_libpebble2()
    from libpebble2.communication import PebbleConnection
    from libpebble2.communication.transports.websocket import WebsocketTransport
    from libpebble2.services.appmessage import AppMessageService, ByteArray

    keys, keys_src = load_message_keys(args.build_dir)
    names = {v: k for k, v in keys.items()}
    app_uuid = load_uuid()
    url = args.ws or emulator_ws(args.platform)
    print('app %s, keys from %s: %s' % (app_uuid, os.path.relpath(keys_src, ROOT), keys))
    print('connecting to %s' % url)

    pebble = PebbleConnection(WebsocketTransport(url))
    pebble.connect()
    pebble.run_async()
    service = AppMessageService(pebble)

    try:
        from libpebble2.protocol.apps import AppRunState, AppRunStateRequest
        state = pebble.send_and_read(AppRunState(data=AppRunStateRequest()), AppRunState, timeout=5)
        running = getattr(state.data, 'uuid', None)
        print('running app: %s%s' % (running, '' if running == app_uuid else '  (NOT TileStyle)'))
    except Exception as e:  # informational only
        print('running app: unknown (%s)' % e)

    replies = {}  # txid -> 'ACK' | 'NACK'; a reply can arrive before send_message returns
    cond = threading.Condition()

    def on_reply(kind):
        def handler(txid, app):
            with cond:
                replies[txid] = kind
                cond.notify_all()
        return handler

    service.register_handler('ack', on_reply('ACK'))
    service.register_handler('nack', on_reply('NACK'))

    def on_message(txid, app, data):
        if app != app_uuid:
            return
        shown = {names.get(k, k): (v.hex() if isinstance(v, (bytes, bytearray)) else v) for k, v in data.items()}
        print('watch -> phone: %s' % shown)

    service.register_handler('appmessage', on_message)

    failed = False
    for name, data in blobs:
        if name not in keys:
            sys.exit('message key %s not in %s' % (name, keys_src))
        with cond:
            txid = service.send_message(app_uuid, {keys[name]: ByteArray(data)})
            cond.wait_for(lambda: txid in replies, args.timeout)
            result = replies.pop(txid, 'timeout')
        print('%-7s %4d bytes -> %s' % (name, len(data), result))
        failed = failed or result != 'ACK'
        time.sleep(0.2)

    if args.listen:
        print('listening for %g s...' % args.listen)
        time.sleep(args.listen)
    service.shutdown()
    try:
        pebble.transport.ws.close()
    except Exception:
        pass
    if failed:
        print('not acknowledged: is the TileStyle watchface running and its inbox big enough?')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
