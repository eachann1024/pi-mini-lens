"""Opt-in real Pi terminal smoke test, isolated from user settings and providers.
Run: python3 test/minimal-pty.py. No model calls or external network required.
"""
import os, pty, select, signal, struct, fcntl, termios, tempfile, json, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def receive(fd, seconds):
    chunks = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)
        # Answer terminal capability queries like an ordinary terminal.
        if b'\x1b[6n' in data:
            os.write(fd, b'\x1b[1;1R')
        if b'\x1b[c' in data:
            os.write(fd, b'\x1b[?1;2c')
    return b''.join(chunks)

with tempfile.TemporaryDirectory(prefix='mini-lens-pty-') as directory:
    agent = Path(directory) / 'agent'
    agent.mkdir()
    (agent / 'settings.json').write_text(json.dumps({'quietStartup': True, 'theme': 'dark'}))
    (agent / 'mini-lens.json').write_text(json.dumps({'mini-lens-minimal-show': True, 'onboardingCompleted': True}))
    timestamp = '2026-09-07T00:00:00.000Z'
    entries = [{'type': 'session', 'version': 3, 'id': 'f09aa6aa-bfe8-4d85-b817-426a3089498a', 'timestamp': timestamp, 'cwd': directory}]
    parent = None
    def message(content):
        global parent
        entry_id = str(len(entries)).zfill(8)
        entries.append({'type': 'message', 'id': entry_id, 'parentId': parent, 'timestamp': timestamp, 'message': content})
        parent = entry_id
    message({'role': 'user', 'content': 'PTY_QUESTION', 'timestamp': 1788739200000})
    message({'role': 'assistant', 'content': [{'type': 'toolCall', 'id': str(i), 'name': 'bash', 'arguments': {'command': f'echo PTY_PROCESS_{i}'}} for i in range(8)], 'api': 'openai-completions', 'provider': 'fixture', 'model': 'fixture', 'stopReason': 'toolUse', 'usage': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 0, 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}}, 'timestamp': 1788739200000})
    for i in range(8):
        message({'role': 'toolResult', 'toolCallId': str(i), 'toolName': 'bash', 'content': [{'type': 'text', 'text': f'PTY_PROCESS_{i}'}], 'isError': False, 'timestamp': 1788739200000})
    message({'role': 'assistant', 'content': [{'type': 'text', 'text': 'PTY_FINAL'}], 'api': 'openai-completions', 'provider': 'fixture', 'model': 'fixture', 'stopReason': 'stop', 'usage': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 0, 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}}, 'timestamp': 1788739200000})
    widget_extension = Path(directory) / 'agent-widget.ts'
    widget_extension.write_text('export default function(pi) { pi.on("session_start", (_event, ctx) => { ctx.ui.setWidget("fixture-agent", ["async subagent · background", "● reviewer · running · 3 turns", "task: PTY_AGENT_TASK", "Press ctrl+option+o for live detail"]); }); }')
    session = Path(directory) / 'fixture.jsonl'
    session.write_text('\n'.join(json.dumps(entry) for entry in entries) + '\n')
    for mode in ['regular', 'fullscreen']:
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(directory)
            for key in list(os.environ):
                if key.startswith('PI_'):
                    del os.environ[key]
            os.environ['PI_CODING_AGENT_DIR'] = str(agent)
            os.environ['TERM'] = 'xterm-256color'
            os.execvp('node', ['node', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'), '-ne', '-ns', '-np', '-nc', '--no-themes', '--no-tools', '--tui-mode', mode, '--session', str(session), '-e', str(ROOT / 'extensions/footer-status.ts'), '-e', str(widget_extension)])
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))
            start = receive(fd, 8)
            (Path(tempfile.gettempdir()) / f'mini-lens-{mode}-startup.log').write_bytes(start)
            os.write(fd, b'/mini-lens-minimal on\r')
            enabled = receive(fd, 3)
            combined = start + enabled
            (Path(tempfile.gettempdir()) / f'mini-lens-{mode}-startup.log').write_bytes(combined)
            assert b'Ctrl+O' in combined, combined.decode(errors='replace')[-5000:]
            assert '我们的极简模块'.encode() not in combined
            assert '已收起'.encode() not in combined
            assert '最终的结果'.encode() not in combined
            assert b'PTY_FINAL' in combined
            assert '无法识别'.encode() not in combined
            os.write(fd, b'/mini-lens-minimal off\r')
            disabled = receive(fd, 2)
            assert b'$ echo PTY_PROCESS_' in disabled, disabled.decode(errors='replace')[-5000:]
            os.write(fd, b'/mini-lens-minimal on\r')
            reenabled = receive(fd, 2)
            assert b'Ctrl+O' in reenabled
            assert '后台 Agents'.encode() in reenabled
            assert b'PTY_AGENT_TASK' not in reenabled
            assert b'PTY_PROCESS_0' not in reenabled
            assert b'PTY_PROCESS_1' not in reenabled
            assert b'PTY_PROCESS_7' in reenabled
            assert b'PTY_PROCESS_2' in reenabled
            os.write(fd, b'\x0f')
            expanded = receive(fd, 2)
            assert b'PTY_PROCESS_7' in expanded
            assert b'PTY_AGENT_TASK' in expanded
            os.write(fd, b'\x0f')
            collapsed = receive(fd, 2)
            assert b'PTY_PROCESS_7' in collapsed
            os.write(fd, b'/reload\r')
            reloaded = receive(fd, 4)
            assert '无法识别'.encode() not in reloaded, reloaded.decode(errors='replace')[-3000:]
            assert '调用与过程'.encode() in reloaded
            assert b'PTY_FINAL' in reloaded
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 40, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            narrow = receive(fd, 1)
            assert b'Error:' not in narrow
            log = Path(tempfile.gettempdir()) / f'mini-lens-{mode}-pty.log'
            log.write_bytes(start + enabled + disabled + reenabled + reloaded + narrow)
            print(f'{mode}: real Pi startup, enable/off/enable, collapsed process / Ctrl+O expand-collapse, final, resize PASS; {log}')
        finally:
            # This disposable test owns the child; do not wait on interactive exit prompts.
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            os.close(fd)
