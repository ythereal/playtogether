// Game registry. The lobby (index.html) lists every entry here.
// To add a game: create games/<id>/index.html and add an entry below.
window.PT_GAMES = [
  {
    id: 'pong',
    name: 'Pong',
    blurb: 'The classic, face to face. Your paddle is always at the bottom. First to 7.',
    icon: '▮●',
    type: 'Real-time',
  },
  {
    id: 'connect4',
    name: 'Connect Four',
    blurb: 'Drop discs, line up four before they do.',
    icon: '●●',
    type: 'Turn-based',
  },
  {
    id: 'battleship',
    name: 'Battleship',
    blurb: 'Hide your fleet, hunt theirs. Five ships each.',
    icon: '⚓',
    type: 'Turn-based',
  },
  {
    id: 'tictactoe',
    name: 'Tic-Tac-Toe',
    blurb: 'Three in a row. Loser picks the next game.',
    icon: '✕○',
    type: 'Turn-based',
  },
];
