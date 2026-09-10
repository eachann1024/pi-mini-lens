"""Opt-in real Pi terminal smoke test, isolated from user settings and providers.
Run: python3 test/minimal-pty.py. No model calls or external network required.
"""
import os, pty, select, signal, struct, fcntl, termios, tempfile, json, time, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = Path(os.environ.get('PI_MINI_TEST_CLI', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')))

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
    message({'role': 'assistant', 'content': [{'type': 'text', 'text': '**PTY_FINAL。 **中文后续\n\n- `AiErrorLogController.java`\n- **KnowallLog.post**'}], 'api': 'openai-completions', 'provider': 'fixture', 'model': 'fixture', 'stopReason': 'stop', 'usage': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 0, 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}}, 'timestamp': 1788739200000})
    widget_extension = Path(directory) / 'agent-widget.ts'
    widget_extension.write_text('''import { createAssistantMessageEventStream } from "''' + str(ROOT / 'node_modules/@earendil-works/pi-ai/dist/compat.js') + '''";
    export default function(pi) {
      let timer;
      pi.registerProvider("fixture", {
        baseUrl: "http://127.0.0.1:1", apiKey: "local-fixture", api: "fixture-api",
        models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        streamSimple() {
          const stream = createAssistantMessageEventStream();
          const message = { role: "assistant", api: "fixture-api", provider: "fixture", model: "fixture", content: [], stopReason: "stop", timestamp: Date.now(), usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          setTimeout(async () => {
            stream.push({ type: "start", partial: message });
            message.content.push({ type: "thinking", thinking: "PTY_LIVE_THOUGHT" });
            stream.push({ type: "thinking_delta", contentIndex: 0, delta: "PTY_LIVE_THOUGHT", partial: message });
            await new Promise(resolve => setTimeout(resolve, 300));
            stream.push({ type: "thinking_end", contentIndex: 0, content: "PTY_LIVE_THOUGHT", partial: message });
            message.content.push({ type: "text", text: "PTY_FOLLOW_UP_ANSWER" });
            stream.push({ type: "text_delta", contentIndex: 1, delta: "PTY_FOLLOW_UP_ANSWER", partial: message });
            stream.push({ type: "done", reason: "stop", message });
            stream.end();
          }, 0);
          return stream;
        }
      });
      pi.registerCommand("fixture-complete", { handler: async () => {
        pi.sendMessage({ customType: "fixture-result", content: "PTY_COMPLETION_RECEIPT", display: true }, { triggerTurn: true });
      } });
      pi.on("session_start", (_event, ctx) => {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let frame = 0;
        const update = () => ctx.ui.setWidget("fixture-agent", [frames[frame++ % frames.length] + " Async agents · background", "● reviewer · running", "task: PTY_NATIVE_DETAIL", "Press ctrl+option+o for live detail"]);
        update(); timer = setInterval(update, 100); timer.unref();
      });
      pi.on("session_shutdown", () => clearInterval(timer));
    }''')
    session = Path(directory) / 'fixture.jsonl'
    session.write_text('\n'.join(json.dumps(entry) for entry in entries) + '\n')
    status_root = Path(directory) / 'statuses'
    status_dir = status_root / 'async-subagent-runs' / 'fixture-run'
    status_dir.mkdir(parents=True)
    (status_dir / 'status.json').write_text(json.dumps({'sessionId': str(session), 'runId': 'fixture-run', 'toolCallId': '0', 'mode': 'single', 'state': 'running', 'steps': [{'agent': 'reviewer', 'model': '9router/low', 'thinking': 'high', 'status': 'running', 'recentOutput': ['PTY_AGENT_DETAIL', 'PTY_AGENT_TASK']}]}))
    for mode in ['regular', 'fullscreen']:
        # Exercise the normal startup setting, not a CLI override that can hide
        # a mismatch with the user's default launch mode.
        (agent / 'settings.json').write_text(json.dumps({'quietStartup': True, 'theme': 'dark', 'tuiMode': mode}))
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(directory)
            for key in list(os.environ):
                if key.startswith('PI_'):
                    del os.environ[key]
            os.environ['PI_CODING_AGENT_DIR'] = str(agent)
            os.environ['TERM'] = 'xterm-256color'
            os.environ['PI_SUBAGENTS_TEMP_ROOT'] = str(status_root)
            os.execvp('node', ['node', str(CLI), '-ne', '-ns', '-np', '-nc', '--no-themes', '--no-tools', '--session', str(session), '-e', str(ROOT / 'extensions/footer-status.ts'), '-e', str(widget_extension)])
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))
            start = receive(fd, 8)
            (Path(tempfile.gettempdir()) / f'mini-lens-{mode}-startup.log').write_bytes(start)
            os.write(fd, b'/mini-lens-minimal on\r')
            enabled = receive(fd, 3)
            combined = start + enabled
            (Path(tempfile.gettempdir()) / f'mini-lens-{mode}-startup.log').write_bytes(combined)
            if mode == 'regular':
                # Regular mode intentionally keeps Pi's native transcript: replacing it
                # makes historical stream updates clear terminal scrollback.
                assert b'Agent' not in combined
                assert b'PTY_FINAL' in combined
                assert b'**PTY_FINAL' in combined
            else:
                assert b'Agent' in combined, combined.decode(errors='replace')[-5000:]
                assert '我们的极简模块'.encode() not in combined
                assert '已收起'.encode() not in combined
                assert '最终的结果'.encode() not in combined
                assert b'PTY_FINAL' in combined
                assert b'**PTY_FINAL' not in combined
                assert b'AiErrorLogController.java' in combined
                assert b'**KnowallLog.post**' not in combined
                assert '无法识别'.encode() not in combined
            if mode == 'regular':
                continue
            os.write(fd, b'/mini-lens-minimal off\r')
            disabled = receive(fd, 2)
            assert b'$ echo PTY_PROCESS_' in disabled, disabled.decode(errors='replace')[-5000:]
            os.write(fd, b'/mini-lens-minimal on\r')
            reenabled = receive(fd, 2)
            assert b'Agent' in reenabled
            assert b'Subagent' in reenabled
            assert b'PTY_AGENT_TASK' in reenabled
            assert 'SubAgent • low high : PTY_AGENT_TASK'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', reenabled)
            assert b'PTY_AGENT_DETAIL' not in reenabled
            assert b'Async agents' not in reenabled
            assert b'PTY_NATIVE_DETAIL' not in reenabled
            assert b'PTY_PROCESS_0' not in reenabled
            assert b'PTY_PROCESS_1' not in reenabled
            assert b'PTY_PROCESS_7' in reenabled
            assert b'PTY_PROCESS_2' not in reenabled
            plain_reenabled = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', reenabled)
            assert re.search(rb'Agent[^\r\n]*Subagent 0/1', plain_reenabled), plain_reenabled[-4000:]
            assert plain_reenabled.index(b'PTY_PROCESS_7') < plain_reenabled.index(b'PTY_AGENT_TASK') < plain_reenabled.index(b'PTY_FINAL')
            assert '运行中'.encode() not in reenabled
            os.write(fd, b'\x0f')
            expanded = receive(fd, 2)
            assert b'PTY_PROCESS_7' in expanded
            assert b'PTY_AGENT_TASK' in expanded
            os.write(fd, b'\x0f')
            collapsed = receive(fd, 2)
            assert b'PTY_PROCESS_7' in collapsed
            os.write(fd, b'\x13')
            child_expanded = receive(fd, 1)
            assert b'PTY_AGENT_DETAIL' not in child_expanded
            assert b'PTY_AGENT_TASK' in child_expanded
            assert b'Async agents' not in child_expanded
            os.write(fd, b'\x13')
            child_collapsed = receive(fd, 1)
            assert b'Async agents' not in child_collapsed
            os.write(fd, b'/reload\r')
            reloaded = receive(fd, 4)
            (Path(tempfile.gettempdir()) / f'mini-lens-{mode}-reload.log').write_bytes(reloaded)
            assert '无法识别'.encode() not in reloaded, reloaded.decode(errors='replace')[-3000:]
            assert b'Agent' in reloaded
            assert b'PTY_FINAL' in reloaded
            assert b'Subagent' in reloaded
            assert b'PTY_AGENT_TASK' in reloaded
            assert b'Async agents' not in reloaded
            assert b'PTY_NATIVE_DETAIL' not in reloaded
            status_file = status_dir / 'status.json'
            snapshot = json.loads(status_file.read_text())
            snapshot['state'] = 'completed'
            snapshot['steps'][0]['workflowKey'] = 'PTY_TITLE'
            snapshot['endedAt'] = int(time.time() * 1000)
            snapshot['steps'][0]['recentOutput'] = ['PTY_COMPLETED_RESULT']
            status_file.write_text(json.dumps(snapshot))
            completed = receive(fd, 2)
            assert b'PTY_COMPLETED_RESULT' in completed
            assert '✓'.encode() in completed
            assert b'1/1' in completed
            assert b'PTY_AGENT_TASK' not in completed
            os.write(fd, b'\x13')
            revealed = receive(fd, 1)
            # Ctrl+S cannot change terminal lifetime; force a full frame to verify.
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 101, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            revealed += receive(fd, 1)
            assert b'PTY_COMPLETED_RESULT' in revealed
            assert 'SubAgent • low high : PTY_COMPLETED_RESULT'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', revealed)
            assert b'PTY_TITLE' not in revealed
            os.write(fd, b'\x13')
            receive(fd, 1)
            os.write(fd, b'/fixture-complete\r')
            followup = receive(fd, 4)
            assert b'PTY_COMPLETION_RECEIPT' in followup, followup.decode(errors='replace')[-5000:]
            assert b'PTY_FOLLOW_UP_ANSWER' in followup, followup.decode(errors='replace')[-5000:]
            os.write(fd, b'/reload\r')
            restored = receive(fd, 4)
            assert b'PTY_FOLLOW_UP_ANSWER' in restored
            assert b'PTY_COMPLETION_RECEIPT' in restored
            assert b'PTY_FINAL' in restored
            # /reload briefly renders the native transcript while extensions remount.
            # Check the stable minimal frame after a real terminal resize.
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 102, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            settled_frame = receive(fd, 1)
            assert b'PTY_FOLLOW_UP_ANSWER' in settled_frame
            assert b'PTY_LIVE_THOUGHT' not in settled_frame
            assert b'Thinking' not in settled_frame
            assert b'PTY_COMPLETED_RESULT' not in settled_frame
            assert b'Subagent' not in settled_frame, 'terminal line expires and reload does not revive it'
            snapshot['state'] = 'running'
            snapshot['steps'][0]['status'] = 'running'
            snapshot['steps'][0]['recentOutput'] = ['PTY_AGENT_TASK']
            status_file.write_text(json.dumps(snapshot))
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 40, 0, 0))
            os.kill(pid, signal.SIGWINCH)
            narrow = receive(fd, 1)
            assert b'Error:' not in narrow
            log = Path(tempfile.gettempdir()) / f'mini-lens-{mode}-pty.log'
            log.write_bytes(start + enabled + disabled + reenabled + child_expanded + child_collapsed + reloaded + followup + restored + settled_frame + narrow)
            print(f'{mode}: real Pi lifecycle, async receipt/follow-up/reload, title, 10s completion expiry, thinking cleanup, resize PASS; {log}', flush=True)
        finally:
            # This disposable test owns the child; do not wait on interactive exit prompts.
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            os.close(fd)
