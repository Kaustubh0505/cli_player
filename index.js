const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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

function render() {
  console.clear();
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
  console.log('Controls: [↑/↓] Navigate | [Enter] Play | [P] Pause/Resume | [Q] Quit');
}

function stopSong() {
  if (vlcProcess) {
    vlcProcess.removeAllListeners('exit');
    try {
      vlcProcess.kill();
    } catch (_) {}
    vlcProcess = null;
  }
}

function playSong(index) {
  stopSong();
  playingIndex = index;
  isPaused = false;
  const songPath = path.join(songsDir, songs[index]);

  const proc = spawn('vlc', ['-I', 'rc', '--no-video', '--play-and-exit', songPath], {
    stdio: ['pipe', 'pipe', 'ignore']
  });

  proc.on('error', (err) => {
    console.error('\nError launching VLC:', err.message);
  });

  proc.on('exit', () => {
    if (vlcProcess === proc) {
      vlcProcess = null;
      playingIndex = -1;
      isPaused = false;
      render();
    }
  });

  vlcProcess = proc;
}

function togglePause() {
  if (vlcProcess && playingIndex !== -1) {
    isPaused = !isPaused;
    vlcProcess.stdin.write('pause\n');
  }
}

function cleanup() {
  stopSong();
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
  } else if (key.name === 'return') {
    playSong(selectedIndex);
    render();
  } else if (key.name === 'p') {
    togglePause();
    render();
  }
});

process.on('SIGINT', cleanup);
process.on('exit', stopSong);

render();
