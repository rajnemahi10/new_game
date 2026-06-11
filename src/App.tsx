import { useEffect, useMemo, useRef, useState } from "react";

type Piece = "wizard" | "warrior" | "dragon" | "goblin";
type Role = "host" | "guest";
type Page = "lobby" | "waiting" | "joining" | "game";
type BuilderTab = "size" | "shape" | "bonus";
type BonusValue = 2 | 3;

type Room = {
  code: string;
  host: string;
  guest: string | null;
  status: "waiting" | "playing" | "finished";
};

type BoardSetup = {
  size: number;
  excluded: number[];
  bonus: Record<string, BonusValue>;
};

type PlayerState = {
  name: string;
  pts: number;
  pieces: Record<Piece, number>;
};

type MoveState = {
  done: boolean;
  cell: number | null;
  piece: Piece | null;
};

type GameLogEntry = {
  msg: string;
  cls?: string;
};

type BoardPiece = {
  owner: 0 | 1;
  piece: Piece;
};

type GameState = {
  setup: BoardSetup;
  board: Record<string, BoardPiece | null>;
  locked: Record<string, boolean>;
  usedBonus: number[];
  players: [PlayerState, PlayerState];
  moves: [MoveState, MoveState];
  round: number;
  log: GameLogEntry[];
  over: boolean;
};

type SessionState = {
  code: string;
  role: Role;
  name: string;
};

const ICONS: Record<Piece, string> = {
  wizard: "🧙",
  warrior: "⚔️",
  dragon: "🐉",
  goblin: "👺",
};

const WORTH: Record<Piece, number> = {
  wizard: 2,
  warrior: 2,
  dragon: 2,
  goblin: 5,
};

const COST: Record<Piece, number> = {
  wizard: 2,
  warrior: 2,
  dragon: 2,
  goblin: 5,
};

const TRAPS: Record<Piece, Piece | undefined> = {
  warrior: "wizard",
  wizard: "dragon",
  dragon: "warrior",
  goblin: undefined,
};

const STORAGE_PREFIX = "trapgrid";
const SESSION_KEY = `${STORAGE_PREFIX}:session`;

const PIECE_ORDER: Piece[] = ["wizard", "warrior", "dragon", "goblin"];

function roomKey(code: string) {
  return `${STORAGE_PREFIX}:room:${code}`;
}

function stateKey(code: string) {
  return `${STORAGE_PREFIX}:state:${code}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readSession(): SessionState | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

function writeSession(value: SessionState | null) {
  if (!value) {
    window.sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function blankPieces() {
  return { wizard: 3, warrior: 3, dragon: 3, goblin: 1 };
}

function makeEmptyBoard(size: number) {
  const board: Record<string, BoardPiece | null> = {};
  const locked: Record<string, boolean> = {};
  for (let i = 0; i < size * size; i += 1) {
    board[String(i)] = null;
    locked[String(i)] = false;
  }
  return { board, locked };
}

function cloneGameState(state: GameState): GameState {
  return {
    setup: {
      size: state.setup.size,
      excluded: [...state.setup.excluded],
      bonus: { ...state.setup.bonus },
    },
    board: { ...state.board },
    locked: { ...state.locked },
    usedBonus: [...state.usedBonus],
    players: state.players.map((player) => ({
      ...player,
      pieces: { ...player.pieces },
    })) as [PlayerState, PlayerState],
    moves: state.moves.map((move) => ({ ...move })) as [MoveState, MoveState],
    round: state.round,
    log: state.log.map((entry) => ({ ...entry })),
    over: state.over,
  };
}

function createGameState(room: Room, setup: BoardSetup): GameState {
  const { board, locked } = makeEmptyBoard(setup.size);
  return {
    setup: {
      size: setup.size,
      excluded: [...setup.excluded],
      bonus: { ...setup.bonus },
    },
    board,
    locked,
    usedBonus: [],
    players: [
      { name: room.host, pts: 0, pieces: blankPieces() },
      { name: room.guest ?? "Guest", pts: 0, pieces: blankPieces() },
    ],
    moves: [
      { done: false, cell: null, piece: null },
      { done: false, cell: null, piece: null },
    ],
    round: 1,
    log: [{ msg: "Game started!" }],
    over: false,
  };
}

function resolveVs(a: Piece, b: Piece) {
  if (a === b) return -1;
  if (b === "goblin") return 0;
  if (a === "goblin") return 1;
  if (TRAPS[a] === b) return 0;
  if (TRAPS[b] === a) return 1;
  return -1;
}

function addPlacementScore(state: GameState, owner: 0 | 1, piece: Piece, cellIndex: number) {
  const bonus = state.setup.bonus[String(cellIndex)];
  const bonusIsFresh = bonus && !state.usedBonus.includes(cellIndex);
  if (bonusIsFresh) {
    state.usedBonus.push(cellIndex);
  }
  state.players[owner].pts += WORTH[piece] * (bonusIsFresh ? bonus : 1);
}

function checkSequences(state: GameState) {
  const n = state.setup.size;
  for (let owner: 0 | 1 = 0; owner < 2; owner = (owner + 1) as 0 | 1) {
    const lines: Array<[number, number, number]> = [];
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n - 2; c += 1) {
        lines.push([r * n + c, r * n + c + 1, r * n + c + 2]);
      }
    }
    for (let c = 0; c < n; c += 1) {
      for (let r = 0; r < n - 2; r += 1) {
        lines.push([r * n + c, (r + 1) * n + c, (r + 2) * n + c]);
      }
    }

    lines.forEach(([a, mid, b]) => {
      const ka = String(a);
      const km = String(mid);
      const kb = String(b);
      if (state.locked[km]) return;
      const sa = state.board[ka];
      const sm = state.board[km];
      const sb = state.board[kb];
      if (!sa || !sm || !sb) return;
      if (sa.owner !== owner || sb.owner !== owner || sm.owner === owner) return;
      if (sa.piece !== sb.piece) return;
      if (TRAPS[sa.piece] !== sm.piece) return;
      state.players[owner].pts += WORTH[sa.piece] * 2 + WORTH[sm.piece];
      state.locked[km] = true;
    });
  }
}

function resolveTurn(state: GameState) {
  const next = cloneGameState(state);
  const move0 = next.moves[0];
  const move1 = next.moves[1];

  if (!move0.piece || move0.cell === null || !move1.piece || move1.cell === null) {
    return next;
  }

  next.players[0].pieces[move0.piece] -= 1;
  next.players[1].pieces[move1.piece] -= 1;

  const k0 = String(move0.cell);
  const k1 = String(move1.cell);

  if (move0.cell === move1.cell) {
    const winner = resolveVs(move0.piece, move1.piece);
    if (winner === 0) {
      next.board[k0] = { owner: 0, piece: move0.piece };
      addPlacementScore(next, 0, move0.piece, move0.cell);
    } else if (winner === 1) {
      next.board[k0] = { owner: 1, piece: move1.piece };
      addPlacementScore(next, 1, move1.piece, move1.cell);
    } else {
      next.locked[k0] = true;
      next.board[k0] = null;
    }
  } else {
    const turns: Array<{ move: MoveState; owner: 0 | 1; key: string }> = [
      { move: move0, owner: 0, key: k0 },
      { move: move1, owner: 1, key: k1 },
    ];

    turns.forEach(({ move, owner, key }) => {
      if (next.locked[key] || !move.piece || move.cell === null) return;
      const existing = next.board[key];
      if (!existing) {
        next.board[key] = { owner, piece: move.piece };
        addPlacementScore(next, owner, move.piece, move.cell);
        return;
      }
      if (existing.owner === owner) return;
      const winner = resolveVs(owner === 0 ? move.piece : existing.piece, owner === 0 ? existing.piece : move.piece);
      if (winner === owner) {
        next.board[key] = { owner, piece: move.piece };
        addPlacementScore(next, owner, move.piece, move.cell);
      } else if (winner === -1) {
        next.locked[key] = true;
        next.board[key] = null;
      }
    });
  }

  checkSequences(next);
  next.moves = [
    { done: false, cell: null, piece: null },
    { done: false, cell: null, piece: null },
  ];
  next.round += 1;

  const playable = [] as number[];
  for (let i = 0; i < next.setup.size * next.setup.size; i += 1) {
    if (!next.setup.excluded.includes(i)) playable.push(i);
  }
  if (playable.every((index) => next.board[String(index)] || next.locked[String(index)])) {
    next.over = true;
  }

  next.log = [
    ...next.log,
    { msg: `Round ${next.round - 1} resolved.` },
    next.over ? { msg: "The board is full." } : { msg: `Round ${next.round} begins.` },
  ];

  return next;
}

function roomPage(session: SessionState | null, room: Room | null): Page {
  if (!session) return "lobby";
  if (room?.status === "playing") return "game";
  return session.role === "host" ? "waiting" : "joining";
}

function emptySetup(): BoardSetup {
  return { size: 6, excluded: [], bonus: {} };
}

function App() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionState | null>(() => readSession());
  const [room, setRoom] = useState<Room | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [setup, setSetup] = useState<BoardSetup>(emptySetup);
  const [builderTab, setBuilderTab] = useState<BuilderTab>("size");
  const [bonusMode, setBonusMode] = useState<"normal" | "x2" | "x3">("normal");
  const [pending, setPending] = useState<{ piece: Piece | null; cell: number | null }>({
    piece: null,
    cell: null,
  });
  const copyTimer = useRef<number | null>(null);

  const page = useMemo(() => roomPage(session, room), [session, room]);

  const myIndex = session?.role === "host" ? 0 : 1;
  const opIndex = session?.role === "host" ? 1 : 0;

  const saveRoom = (nextRoom: Room) => {
    writeJson(roomKey(nextRoom.code), nextRoom);
    setRoom(nextRoom);
  };

  const saveGame = (code: string, nextState: GameState) => {
    writeJson(stateKey(code), nextState);
    setGameState(nextState);
  };

  const refreshSession = (nextSession: SessionState | null) => {
    writeSession(nextSession);
    setSession(nextSession);
    if (!nextSession) {
      setRoom(null);
      setGameState(null);
      setPending({ piece: null, cell: null });
      return;
    }
    const nextRoom = readJson<Room>(roomKey(nextSession.code));
    const nextState = readJson<GameState>(stateKey(nextSession.code));
    setRoom(nextRoom);
    setGameState(nextState);
    setPending({ piece: null, cell: null });
  };

  useEffect(() => {
    if (!session) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== roomKey(session.code) && event.key !== stateKey(session.code)) return;
      const nextRoom = readJson<Room>(roomKey(session.code));
      const nextState = readJson<GameState>(stateKey(session.code));
      setRoom(nextRoom);
      setGameState(nextState);
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const nextRoom = readJson<Room>(roomKey(session.code));
    if (!nextRoom) {
      refreshSession(null);
      return;
    }
    const nextState = readJson<GameState>(stateKey(session.code));
    setRoom(nextRoom);
    setGameState(nextState);
  }, [session]);

  useEffect(() => {
    if (!session || session.role !== "host" || !gameState || gameState.over) return;
    if (!gameState.moves[0].done || !gameState.moves[1].done) return;
    const resolved = resolveTurn(gameState);
    saveGame(session.code, resolved);
  }, [gameState, session]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copyCode = async () => {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      const el = document.getElementById("disp-code");
      if (el) {
        const original = el.textContent;
        el.textContent = "COPIED";
        copyTimer.current = window.setTimeout(() => {
          el.textContent = original ?? room.code;
        }, 900);
      }
    } catch {
      // No-op: clipboard may be unavailable.
    }
  };

  const createRoom = async () => {
    setError("");
    const hostName = name.trim() || "Player 1";
    const code = makeCode();
    const nextRoom: Room = { code, host: hostName, guest: null, status: "waiting" };
    saveRoom(nextRoom);
    refreshSession({ code, role: "host", name: hostName });
    setSetup(emptySetup());
    setBuilderTab("size");
  };

  const joinRoom = async () => {
    setError("");
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Enter a 6-character room code.");
      return;
    }
    const nextRoom = readJson<Room>(roomKey(code));
    if (!nextRoom || nextRoom.guest) {
      setError("Room not found or already full.");
      return;
    }

    const guestName = name.trim() || "Player 2";
    const updatedRoom: Room = { ...nextRoom, guest: guestName };
    saveRoom(updatedRoom);
    refreshSession({ code, role: "guest", name: guestName });

    const nextState = readJson<GameState>(stateKey(code));
    if (nextState && updatedRoom.status === "playing") {
      setGameState(nextState);
    }
  };

  const startGame = async () => {
    if (!session || session.role !== "host" || !room) return;
    if (!room.guest) {
      setError("Wait for the other player to join.");
      return;
    }
    const nextRoom: Room = { ...room, status: "playing" };
    const nextState = createGameState(nextRoom, setup);
    saveGame(room.code, nextState);
    saveRoom(nextRoom);
  };

  const setGridSize = (size: number) => {
    setSetup({ size, excluded: [], bonus: {} });
    setBonusMode("normal");
  };

  const toggleShapeCell = (index: number) => {
    setSetup((current) => {
      const excluded = current.excluded.includes(index)
        ? current.excluded.filter((value) => value !== index)
        : [...current.excluded, index];
      return { ...current, excluded };
    });
  };

  const toggleBonusCell = (index: number) => {
    setSetup((current) => {
      const bonus = { ...current.bonus };
      if (bonusMode === "normal") {
        delete bonus[String(index)];
      } else if (bonusMode === "x2") {
        if (bonus[String(index)] === 2) delete bonus[String(index)];
        else bonus[String(index)] = 2;
      } else if (bonusMode === "x3") {
        if (bonus[String(index)] === 3) delete bonus[String(index)];
        else bonus[String(index)] = 3;
      }
      return { ...current, bonus };
    });
  };

  const selectPiece = (piece: Piece) => {
    if (!gameState || gameState.moves[myIndex].done) return;
    setPending((current) => ({ ...current, piece }));
  };

  const chooseCell = (cell: number) => {
    if (!gameState || gameState.moves[myIndex].done || !pending.piece) return;
    setPending((current) => ({ ...current, cell }));
  };

  const submitMove = async () => {
    if (!session || !gameState || !pending.piece || pending.cell === null) return;
    const next = cloneGameState(gameState);
    next.moves[myIndex] = { done: true, cell: pending.cell, piece: pending.piece };
    next.log = [...next.log, { msg: `${session.name} locked in.` }];
    setPending({ piece: null, cell: null });
    saveGame(session.code, next);
  };

  const buyPiece = async (piece: Piece) => {
    if (!session || !gameState) return;
    const next = cloneGameState(gameState);
    const me = next.players[myIndex];
    if (me.pts < COST[piece] || next.over) return;
    me.pts -= COST[piece];
    me.pieces[piece] += 1;
    next.log = [...next.log, { msg: `${session.name} bought ${piece}.` }];
    saveGame(session.code, next);
  };

  const renderBuilderGrid = (kind: "shape" | "bonus") => {
    const size = setup.size;
    return (
      <div className="bgrid" style={{ gridTemplateColumns: `repeat(${size},40px)` }}>
        {Array.from({ length: size * size }, (_, index) => {
          const isExcluded = setup.excluded.includes(index);
          const bonus = setup.bonus[String(index)];
          const className = [
            "bc",
            isExcluded ? "excl" : "",
            kind === "bonus" && bonus === 2 ? "bx2" : "",
            kind === "bonus" && bonus === 3 ? "bx3" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={`${kind}-${index}`}
              className={className}
              onClick={() => (kind === "shape" ? toggleShapeCell(index) : toggleBonusCell(index))}
            >
              {kind === "bonus" && bonus ? `×${bonus}` : ""}
            </div>
          );
        })}
      </div>
    );
  };

  const renderGameBoard = () => {
    const size = gameState?.setup.size ?? setup.size;
    const excluded = gameState?.setup.excluded ?? setup.excluded;
    const bonus = gameState?.setup.bonus ?? setup.bonus;
    const board = gameState?.board ?? {};
    const locked = gameState?.locked ?? {};
    const isLoading = !gameState;
    return (
      <div className={isLoading ? "gb loading-board" : "gb"} style={{ gridTemplateColumns: `repeat(${size},52px)` }}>
        {Array.from({ length: size * size }, (_, index) => {
          const key = String(index);
          const isExcluded = excluded.includes(index);
          const sq = board[key];
          const isLocked = !!locked[key];
          const submitted = !!gameState?.moves[myIndex].done;
          const bonusType = bonus[key];
          const classes = ["gc"];

          if (isExcluded) classes.push("gx");
          else if (isLocked && !sq) classes.push("gd");
          else if (isLocked) classes.push("glk");
          else if (sq) classes.push(sq.owner === 0 ? "g1" : "g2");
          if (bonusType && (!gameState?.usedBonus || !gameState.usedBonus.includes(index))) {
            classes.push(bonusType === 2 ? "gbx2" : "gbx3");
          }
          if (!submitted && pending.cell === index) classes.push("gsel");

          return (
            <div
              key={key}
              className={classes.join(" ")}
              onClick={() => {
                if (isLoading || isExcluded || isLocked || submitted) return;
                if (!pending.piece) return;
                if (sq && sq.owner === myIndex) return;
                chooseCell(index);
              }}
            >
              {sq ? <div className="pi">{ICONS[sq.piece]}</div> : null}
              {sq ? <div className="od" style={{ background: sq.owner === 0 ? "#1D9E75" : "#534AB7" }} /> : null}
              {bonusType && (!gameState?.usedBonus || !gameState.usedBonus.includes(index)) ? (
                <div className={`bl ${bonusType === 2 ? "x2" : "x3"}`}>×{bonusType}</div>
              ) : null}
              {!isLoading && submitted && gameState?.moves[myIndex].cell === index ? <div className="pend" /> : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div id="pg-lobby" className={`page ${page === "lobby" ? "on" : ""}`}>
        <div className="lw">
          <div className="lc">
            <h1>TrapGrid</h1>
            <p className="sub">Simultaneous strategy - trap your opponent's pieces to claim the board.</p>
            <div className="fld">
              <label htmlFor="inp-name">Your name</label>
              <input
                id="inp-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Alice"
                maxLength={20}
              />
            </div>
            <button className="btn btnp" style={{ width: "100%" }} onClick={createRoom}>
              Create a new room
            </button>
            <hr className="sep" />
            <div className="flex">
              <input
                id="inp-code"
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={6}
                style={{ fontFamily: "monospace", fontSize: 16, letterSpacing: 3, textTransform: "uppercase" }}
              />
              <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={joinRoom}>
                Join room
              </button>
            </div>
            <div id="lb-err" className="err" style={{ display: error ? "block" : "none" }}>
              {error}
            </div>
          </div>
        </div>
      </div>

      <div id="pg-waiting" className={`page ${page === "waiting" ? "on" : ""}`}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <div className="flex mt20" style={{ marginBottom: 16 }}>
            <h2>Room ready</h2>
            <div className="mla flex" style={{ gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>Share this code:</span>
              <div className="code" id="disp-code" title="Click to copy" onClick={copyCode}>
                {room?.code ?? "------"}
              </div>
            </div>
          </div>

          <div className="notice" style={{ marginBottom: 16 }}>
            <span className="pulse" />
            <span>{room?.guest ? `${room.guest} joined!` : "Waiting for opponent to join..."}</span>
          </div>

          <h3 style={{ marginBottom: 12 }}>Board setup</h3>

          <div className="tabs">
            <button className={`tab ${builderTab === "size" ? "on" : ""}`} onClick={() => setBuilderTab("size")}>
              Grid size
            </button>
            <button className={`tab ${builderTab === "shape" ? "on" : ""}`} onClick={() => setBuilderTab("shape")}>
              Shape
            </button>
            <button className={`tab ${builderTab === "bonus" ? "on" : ""}`} onClick={() => setBuilderTab("bonus")}>
              Bonus squares
            </button>
          </div>

          <div id="bt-size" style={{ display: builderTab === "size" ? "block" : "none" }}>
            <div className="flex" style={{ gap: 6, marginBottom: 8 }}>
              {[6, 7, 8].map((size) => (
                <button
                  key={size}
                  className={`btn sbtn ${setup.size === size ? "on" : ""}`}
                  onClick={() => setGridSize(size)}
                >
                  {size}×{size}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--text2)" }}>
              Current: <span id="size-lbl">{setup.size}×{setup.size}</span>
            </p>
          </div>

          <div id="bt-shape" style={{ display: builderTab === "shape" ? "block" : "none" }}>
            <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>Click cells to exclude them from play.</p>
            {renderBuilderGrid("shape")}
          </div>

          <div id="bt-bonus" style={{ display: builderTab === "bonus" ? "block" : "none" }}>
            <div className="flex" style={{ gap: 6, marginBottom: 8 }}>
              <button
                className={`btn sbtn ${bonusMode === "normal" ? "on" : ""}`}
                onClick={() => setBonusMode("normal")}
              >
                Normal
              </button>
              <button className={`btn sbtn ${bonusMode === "x2" ? "on" : ""}`} onClick={() => setBonusMode("x2")}>Paint ×2</button>
              <button className={`btn sbtn ${bonusMode === "x3" ? "on" : ""}`} onClick={() => setBonusMode("x3")}>Paint ×3</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
              Click cells to set bonus type. Click again to clear.
            </p>
            {renderBuilderGrid("bonus")}
          </div>

          <div className="flex mt20">
            <button className="btn btnp" id="start-btn" onClick={startGame} disabled={!room?.guest}>
              Start game
            </button>
            <span id="start-hint" style={{ fontSize: 12, color: "var(--text2)", marginLeft: 10 }}>
              {room?.guest ? "Ready to start!" : "Waiting for opponent to join..."}
            </span>
          </div>
        </div>
      </div>

      <div id="pg-joining" className={`page ${page === "joining" ? "on" : ""}`}>
        <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
          <h2 style={{ marginBottom: 8 }}>Joined!</h2>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>Waiting for the host to start the game.</p>
          <div className="notice" style={{ justifyContent: "center" }}>
            <span className="pulse" />
            <span>{room?.status === "playing" ? "Loading the board..." : "Host is setting up the board..."}</span>
          </div>
        </div>
      </div>

      <div id="pg-game" className={`page ${page === "game" ? "on" : ""}`}>
        <div className="gl">
          <div className="sb">
            <div className="pc me">
              <div className="plbl" id="my-lbl">
                {gameState ? `You (${gameState.players[myIndex]?.name ?? "You"})` : "You"}
              </div>
              <div className="pbig" id="my-pts">
                {gameState ? `${gameState.players[myIndex]?.pts ?? 0} ` : "0 "}<span>pts</span>
              </div>
              <div className="chips" id="my-chips">
                {gameState
                  ? gameState.players[myIndex]?.pieces &&
                    PIECE_ORDER.map((piece) => {
                      const count = gameState.players[myIndex].pieces[piece];
                      if (count <= 0) return null;
                      const disabled = gameState.moves[myIndex].done;
                      const selected = pending.piece === piece;
                      return (
                        <div
                          key={piece}
                          className={`chip ${selected ? "sel" : ""} ${disabled ? "dim" : ""}`}
                          onClick={() => selectPiece(piece)}
                        >
                          {ICONS[piece]} {count}
                        </div>
                      );
                    })
                  : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 7 }}>Buy pieces</div>
              <div className="buychips" id="my-buy">
                {PIECE_ORDER.map((piece) => {
                  const me = gameState?.players[myIndex];
                  const disabled = !gameState || gameState.over || !me || me.pts < COST[piece];
                  return (
                    <button key={piece} className="bchip" disabled={disabled} onClick={() => buyPiece(piece)}>
                      {ICONS[piece]} {COST[piece]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pc op">
              <div className="plbl" id="op-lbl">
                {gameState ? gameState.players[opIndex]?.name ?? "Opponent" : "Opponent"}
              </div>
              <div className="pbig" id="op-pts">
                {gameState ? `${gameState.players[opIndex]?.pts ?? 0} ` : "0 "}<span>pts</span>
              </div>
              <div className="chips" id="op-chips">
                {gameState
                  ? PIECE_ORDER.map((piece) => {
                      const count = gameState.players[opIndex].pieces[piece];
                      if (count <= 0) return null;
                      return (
                        <div key={piece} className="chip dim">
                          {ICONS[piece]} {count}
                        </div>
                      );
                    })
                  : null}
              </div>
            </div>

            <div className="log" id="glog">
              {(gameState?.log ?? [{ msg: "Game started!" }]).map((entry, index) => (
                <p key={`${entry.msg}-${index}`}>{entry.msg}</p>
              ))}
            </div>
          </div>

          <div className="ba">
            <div className="sbar" id="sbar">
              <span className="pulse" id="sbar-pulse" style={{ display: gameState && !gameState.moves[myIndex].done ? "inline-block" : "none" }} />
              <span id="sbar-txt">
                {gameState?.over
                  ? "Game Over!"
                  : !gameState
                    ? "Loading board..."
                    : !gameState.moves[myIndex].done
                      ? pending.piece && pending.cell !== null
                        ? "Click Lock In to submit your move."
                        : "Select a piece and then a square."
                      : "Waiting for opponent..."}
              </span>
              <span className="mla" style={{ fontSize: 12, color: "var(--text3)" }} id="rnd-lbl">
                Round {gameState?.round ?? 1}
              </span>
            </div>

            <div className="lgd">
              <div className="li">
                <div className="lb" style={{ background: "var(--p1bg)", border: "1px solid var(--p1b)" }} />
                P1
              </div>
              <div className="li">
                <div className="lb" style={{ background: "var(--p2bg)", border: "1px solid var(--p2b)" }} />
                P2
              </div>
              <div className="li">
                <div className="lb" style={{ border: "2px solid var(--amber-400)" }} />
                ×2 bonus
              </div>
              <div className="li">
                <div className="lb" style={{ border: "2px solid var(--coral-400)" }} />
                ×3 bonus
              </div>
            </div>

            {renderGameBoard()}

            {!gameState || (!pending.piece && !pending.cell) ? null : (
              <div className="mt12">
                <button className="btn btnp" onClick={submitMove}>
                  Lock In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`wov ${gameState?.over ? "on" : ""}`}>
        <div className="wc">
          <h2>
            {gameState && gameState.players[0].pts > gameState.players[1].pts
              ? `${gameState.players[0].name} wins!`
              : gameState && gameState.players[1].pts > gameState.players[0].pts
                ? `${gameState.players[1].name} wins!`
                : "It's a tie!"}
          </h2>
          <p>
            {gameState
              ? `${gameState.players[0].name}: ${gameState.players[0].pts} pts\n${gameState.players[1].name}: ${gameState.players[1].pts} pts`
              : ""}
          </p>
          <button className="btn btnp" onClick={() => window.location.reload()}>
            Play again
          </button>
        </div>
      </div>
    </>
  );
}

export default App;