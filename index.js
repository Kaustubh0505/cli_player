const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const readline = require('readline');

const songsDir = path.join(__dirname, 'songs');

if (!fs.existsSync(songsDir)) {
  console.error('Error: songs/ directory not found.');
  process.exit(1);
}

const songs = fs.readdirSync(songsDir).filter(file => !file.startsWith('.'));

if (songs.length === 0) {
  console.log('No songs found in songs/ directory.');
  process.exit(1);
}

let selectedIndex = 0;
let playingIndex = -1;
let isPaused = false;
let vlcProcess = null;

let renderInterval = null;
let syncInterval = null;
let totalDuration = 0;
let playbackOffset = 0;
let playbackStartTime = 0;
let hasSynced = false;

function getAudioDuration(filePath) {
  try {
    const out = execSync(`afinfo "${filePath}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const match = out.match(/estimated duration:\s*([\d\.]+)/i);
    if (match) {
      return Math.round(parseFloat(match[1]));
    }
  } catch (_) {}
  return 0;
}

function getCurrentTime() {
  if (playingIndex === -1) return 0;
  if (isPaused) return playbackOffset;
  if (!hasSynced) return playbackOffset;
  const elapsed = (Date.now() - playbackStartTime) / 1000;
  const current = playbackOffset + elapsed;
  return totalDuration > 0 ? Math.min(current, totalDuration) : Math.max(0, current);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

function renderProgressBar(current, total, width = 20) {
  const percent = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(percent * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const icon = isPaused ? '⏸' : '▶';
  return `${icon} ${bar} ${formatTime(current)} / ${formatTime(total)}`;
}

function render() {
  process.stdout.write('\x1B[H\x1B[J\x1B[?25l');
  console.log('🎵 Node CLI Music Player');
  console.log('========================\n');

  songs.forEach((song, i) => {
    const isSelected = i === selectedIndex;
    const isPlayingThis = i === playingIndex;
    const pointer = isSelected ? '>' : ' ';
    const status = isPlayingThis ? (isPaused ? ' [PAUSED]' : ' [PLAYING]') : '';
    console.log(`${pointer} ${i + 1}. ${song}${status}`);
  });

  console.log('\n========================');

  if (playingIndex !== -1) {
    const songName = songs[playingIndex];
    const curTime = getCurrentTime();
    console.log(`Now Playing: ${songName}`);
    console.log(renderProgressBar(curTime, totalDuration, 20));
    console.log('========================');
  }

  console.log('Controls: [↑/↓] Navigate | [←/→] Seek ±10s | [Enter] Play | [P] Pause/Resume | [Q] Quit');
}

function seekSong(seconds) {
  if (vlcProcess && playingIndex !== -1) {
    const cur = getCurrentTime();
    let target = cur + seconds;
    if (totalDuration > 0) {
      target = Math.min(totalDuration, target);
    }
    target = Math.max(0, target);

    playbackOffset = target;
    playbackStartTime = Date.now();
    hasSynced = true;

    vlcProcess.stdin.write(`seek ${Math.round(target)}\n`);
    render();
  }
}

function stopSong() {
  if (renderInterval) {
    clearInterval(renderInterval);
    renderInterval = null;
  }
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (vlcProcess) {
    vlcProcess.removeAllListeners('exit');
    try {
      vlcProcess.kill();
    } catch (_) {}
    vlcProcess = null;
  }
  playingIndex = -1;
  isPaused = false;
  totalDuration = 0;
  playbackOffset = 0;
  playbackStartTime = 0;
  hasSynced = false;
}

function playSong(index) {
  stopSong();
  playingIndex = index;
  isPaused = false;
  hasSynced = false;

  const songPath = path.join(songsDir, songs[index]);
  totalDuration = getAudioDuration(songPath);
  playbackOffset = 0;
  playbackStartTime = Date.now();

  const proc = spawn('vlc', ['-I', 'rc', '--no-video', '--play-and-exit', songPath], {
    stdio: ['pipe', 'pipe', 'ignore']
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split(/[\r\n]+/);
    for (const line of lines) {
      const trimmed = line.replace('>', '').trim();
      if (/^\d+$/.test(trimmed)) {
        const val = parseInt(trimmed, 10);
        if (totalDuration === 0 && val > 30) {
          totalDuration = val;
        } else if (!isPaused) {
          playbackOffset = val;
          playbackStartTime = Date.now();
          hasSynced = true;
        }
      }
    }
  });

  proc.on('error', (err) => {
    console.error('\nError launching VLC:', err.message);
  });

  proc.on('exit', () => {
    if (vlcProcess === proc) {
      stopSong();
      render();
    }
  });

  vlcProcess = proc;

  // Request total duration fallback and initial time sync
  setTimeout(() => {
    if (vlcProcess === proc) {
      vlcProcess.stdin.write('get_length\nget_time\n');
    }
  }, 300);

  // Periodically query VLC time to prevent drift
  syncInterval = setInterval(() => {
    if (vlcProcess && !isPaused) {
      vlcProcess.stdin.write('get_time\n');
    }
  }, 1000);

  // Smooth UI animation timer (100ms interval = 10 FPS)
  renderInterval = setInterval(() => {
    render();
  }, 100);
}

function togglePause() {
  if (vlcProcess && playingIndex !== -1) {
    if (!isPaused) {
      // Pausing
      playbackOffset = getCurrentTime();
      isPaused = true;
    } else {
      // Resuming
      isPaused = false;
      playbackStartTime = Date.now();
    }
    vlcProcess.stdin.write('pause\n');
  }
}

function cleanup() {
  stopSong();
  process.stdout.write('\x1B[?25h');
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  console.clear();
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (_, key) => {
  if (!key) return;

  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    cleanup();
  } else if (key.name === 'up') {
    selectedIndex = (selectedIndex - 1 + songs.length) % songs.length;
    render();
  } else if (key.name === 'down') {
    selectedIndex = (selectedIndex + 1) % songs.length;
    render();
  } else if (key.name === 'left') {
    seekSong(-10);
  } else if (key.name === 'right') {
    seekSong(10);
  } else if (key.name === 'return') {
    playSong(selectedIndex);
    render();
  } else if (key.name === 'p') {
    togglePause();
    render();
  }
});

process.on('SIGINT', cleanup);
process.on('exit', () => {
  process.stdout.write('\x1B[?25h');
  stopSong();
});

render();

