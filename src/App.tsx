import { useEffect, useMemo, useRef, useState } from "react";
import { readRoom, readState, watchRoom, watchState, writeRoom, writeState } from "./firebase";

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
  passed?: boolean;
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

// Per-player team identity, independent of "who is host/guest".
// Player 0 is always "Team Green" and Player 1 is always "Team Purple",
// regardless of which device/role they are.
const TEAM_NAME: [string, string] = ["Green", "Purple"];
const TEAM_VAR: [string, string] = ["--p1b", "--p2b"];
const TEAM_BG_VAR: [string, string] = ["--p1bg", "--p2bg"];

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonLocal(key: string, value: unknown) {
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

// A player has no possible move if they have zero of every piece AND
// cannot afford to buy any piece with their current points.
function hasNoPlayableMove(player: PlayerState): boolean {
  const hasAnyPiece = PIECE_ORDER.some((piece) => player.pieces[piece] > 0);
  if (hasAnyPiece) return false;
  const canAffordAny = PIECE_ORDER.some((piece) => player.pts >= COST[piece]);
  return !canAffordAny;
}

function boardIsFull(state: GameState): boolean {
  const playable: number[] = [];
  for (let i = 0; i < state.setup.size * state.setup.size; i += 1) {
    if (!state.setup.excluded.includes(i)) playable.push(i);
  }
  return playable.length > 0 && playable.every((index) => state.board[String(index)] || state.locked[String(index)]);
}

function resolveTurn(state: GameState): GameState {
  const next = cloneGameState(state);
  const move0 = next.moves[0];
  const move1 = next.moves[1];

  if (!move0.done || !move1.done) {
    return next;
  }

  if (move0.piece && move0.cell !== null) {
    next.players[0].pieces[move0.piece] -= 1;
  }
  if (move1.piece && move1.cell !== null) {
    next.players[1].pieces[move1.piece] -= 1;
  }

  if (
    move0.piece &&
    move1.piece &&
    move0.cell !== null &&
    move1.cell !== null &&
    move0.cell === move1.cell
  ) {
    const k0 = String(move0.cell);
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
    const turns: Array<{ move: MoveState; owner: 0 | 1 }> = [
      { move: move0, owner: 0 },
      { move: move1, owner: 1 },
    ];

    turns.forEach(({ move, owner }) => {
      if (!move.piece || move.cell === null) return;
      const key = String(move.cell);
      if (next.locked[key]) return;
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

  const p0Stuck = hasNoPlayableMove(next.players[0]);
  const p1Stuck = hasNoPlayableMove(next.players[1]);
  const full = boardIsFull(next);

  let endReason: string | null = null;
  if (full) {
    endReason = "The board is full.";
  } else if (p0Stuck && p1Stuck) {
    endReason = "Neither player has any pieces left to play.";
  } else if (p0Stuck) {
    endReason = `${next.players[0].name} has no pieces left and cannot move.`;
  } else if (p1Stuck) {
    endReason = `${next.players[1].name} has no pieces left and cannot move.`;
  }

  if (endReason) {
    next.over = true;
  }

  next.log = [
    ...next.log,
    { msg: `Round ${next.round - 1} resolved.` },
    endReason ? { msg: endReason } : { msg: `Round ${next.round} begins.` },
  ];

  return next;
}

// If, at the start of a round, a player has no piece they can place and no
// points to buy one, auto-mark their move as "passed" so the other player
// isn't stuck waiting forever for a move that can never come.
function applyAutoPasses(state: GameState): GameState {
  if (state.over) return state;
  let changed = false;
  const next = cloneGameState(state);
  for (let i: 0 | 1 = 0; i < 2; i = (i + 1) as 0 | 1) {
    if (!next.moves[i].done && hasNoPlayableMove(next.players[i])) {
      next.moves[i] = { done: true, cell: null, piece: null, passed: true };
      next.log = [...next.log, { msg: `${next.players[i].name} has no pieces left and passes.` }];
      changed = true;
    }
  }
  return changed ? next : state;
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
  const [connError, setConnError] = useState("");
  const copyTimer = useRef<number | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const resolvingRef = useRef(false);

  const page = useMemo(() => roomPage(session, room), [session, room]);

  const myIndex = session?.role === "guest" ? 1 : 0;
  const opIndex = myIndex === 0 ? 1 : 0;

  const saveRoom = async (nextRoom: Room) => {
    try {
      await writeRoom(nextRoom.code, nextRoom);
    } catch (e) {
      setConnError("Couldn't reach the server. Check your connection and Firebase setup.");
    }
  };

  const saveGame = async (code: string, nextState: GameState) => {
    try {
      await writeState(code, nextState);
    } catch (e) {
      setConnError("Couldn't reach the server. Check your connection and Firebase setup.");
    }
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
    setRoom(null);
    setGameState(null);
    setPending({ piece: null, cell: null });
  };

  // Live sync with Firebase Realtime Database — works across devices/browsers.
  useEffect(() => {
    if (!session) return;
    setConnError("");

    const unsubRoom = watchRoom<Room>(session.code, (nextRoom) => {
      if (!nextRoom) {
        // Room was deleted or never existed — bounce back to lobby.
        refreshSession(null);
        return;
      }
      setRoom(nextRoom);
    });

    const unsubState = watchState<GameState>(session.code, (nextState) => {
      if (nextState) {
        gameStateRef.current = nextState;
        setGameState(nextState);
      }
    });

    return () => {
      unsubRoom();
      unsubState();
    };
  }, [session?.code]);

  // Keep an old localStorage backup so a refresh on the same device/tab
  // doesn't lose anything while waiting for the first Firebase snapshot.
  useEffect(() => {
    if (room && session) writeJsonLocal(`${STORAGE_PREFIX}:room:${session.code}`, room);
  }, [room, session]);

  useEffect(() => {
    if (gameState && session) writeJsonLocal(`${STORAGE_PREFIX}:state:${session.code}`, gameState);
  }, [gameState, session]);

  // Host resolves the turn once both players have locked in.
  useEffect(() => {
    if (!session || session.role !== "host" || !gameState || gameState.over) return;
    if (!gameState.moves[0].done || !gameState.moves[1].done) return;
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    const resolved = resolveTurn(gameState);
    const withAutoPass = applyAutoPasses(resolved);
    saveGame(session.code, withAutoPass).finally(() => {
      resolvingRef.current = false;
    });
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
    setConnError("");
    const hostName = name.trim() || "Player 1";
    const code = makeCode();
    const nextRoom: Room = { code, host: hostName, guest: null, status: "waiting" };
    try {
      await writeRoom(code, nextRoom);
      refreshSession({ code, role: "host", name: hostName });
      setSetup(emptySetup());
      setBuilderTab("size");
    } catch (e) {
      setError("Couldn't create the room. Check your connection and Firebase setup.");
    }
  };

  const joinRoom = async () => {
    setError("");
    setConnError("");
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Enter a 6-character room code.");
      return;
    }

    let nextRoom: Room | null = null;
    try {
      nextRoom = await readRoom<Room>(code);
    } catch (e) {
      setError("Couldn't reach the server. Check your connection and Firebase setup.");
      return;
    }

    if (!nextRoom) {
      setError("Room not found.");
      return;
    }
    if (nextRoom.guest) {
      setError("Room is already full.");
      return;
    }

    const guestName = name.trim() || "Player 2";
    const updatedRoom: Room = { ...nextRoom, guest: guestName };
    try {
      await writeRoom(code, updatedRoom);
    } catch (e) {
      setError("Couldn't join the room. Check your connection and Firebase setup.");
      return;
    }
    refreshSession({ code, role: "guest", name: guestName });
  };

  const startGame = async () => {
    if (!session || session.role !== "host" || !room) return;
    if (!room.guest) {
      setError("Wait for the other player to join.");
      return;
    }
    const nextRoom: Room = { ...room, status: "playing" };
    const nextState = createGameState(nextRoom, setup);
    await saveGame(room.code, nextState);
    await saveRoom(nextRoom);
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
    if (!session || !pending.piece || pending.cell === null) return;
    const latest = gameStateRef.current ?? gameState;
    if (!latest || latest.moves[myIndex].done) return;
    const next = cloneGameState(latest);
    next.moves[myIndex] = { done: true, cell: pending.cell, piece: pending.piece };
    next.log = [...next.log, { msg: `${session.name} locked in.` }];
    setPending({ piece: null, cell: null });
    await saveGame(session.code, next);
  };

  const buyPiece = async (piece: Piece) => {
    if (!session) return;
    const latest = gameStateRef.current ?? gameState;
    if (!latest) return;
    const next = cloneGameState(latest);
    const me = next.players[myIndex];
    if (me.pts < COST[piece] || next.over) return;
    me.pts -= COST[piece];
    me.pieces[piece] += 1;
    next.log = [...next.log, { msg: `${session.name} bought ${piece}.` }];
    await saveGame(session.code, next);
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
    // Always render a board, even if gameState is still syncing - prevents "invisible board" flash
    const size = gameState?.setup.size ?? 6;
    const excluded = gameState?.setup.excluded ?? [];
    const bonus = gameState?.setup.bonus ?? {};
    const board = gameState?.board ?? {};
    const locked = gameState?.locked ?? {};
    const isLoading = !gameState;
    const submitted = !!gameState?.moves[myIndex]?.done;

    return (
      <div className="board-wrap">
        <div className={isLoading ? "gb loading-board" : "gb"} style={{ gridTemplateColumns: `repeat(${size}, 54px)` }}>
          {Array.from({ length: size * size }, (_, index) => {
            const key = String(index);
            const isExcluded = excluded.includes(index);
            const sq = board[key] as BoardPiece | null | undefined;
            const isLocked = !!locked[key];
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
                title={
                  isExcluded ? "Excluded" :
                  sq ? `${gameState?.players[sq.owner]?.name ?? (sq.owner===0?"P1":"P2")} (Team ${TEAM_NAME[sq.owner]}) – ${sq.piece}` :
                  bonusType ? `Bonus ×${bonusType}` : "Empty"
                }
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
        {isLoading && (
          <div className="board-loading-overlay">
            <span className="pulse" /> Syncing board…
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div id="pg-lobby" className={`page ${page === "lobby" ? "on" : ""}`}>
        <div className="lw">
          <div className="lc">
            <h1>TrapGrid</h1>
            <p className="sub">Simultaneous strategy — trap your opponent's pieces to claim the board. Share a room code to play with someone on another device.</p>
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
            {connError && (
              <div className="err" style={{ display: "block" }}>
                {connError}
              </div>
            )}
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

          {connError && (
            <div className="err" style={{ display: "block", marginBottom: 16 }}>
              {connError}
            </div>
          )}

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
          {connError && (
            <div className="err" style={{ display: "block", marginTop: 16 }}>
              {connError}
            </div>
          )}
        </div>
      </div>

      <div id="pg-game" className={`page ${page === "game" ? "on" : ""}`}>
        <div className="gl">
          <div className="sb">
            <div className="pc me">
              <div className="plbl" id="my-lbl">
                {gameState ? `You — Team ${TEAM_NAME[myIndex]} (${gameState.players[myIndex]?.name ?? "You"})` : `You — Team ${TEAM_NAME[myIndex]}`}
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
              {gameState && gameState.moves[myIndex]?.passed && (
                <div className="notice mt8" style={{ fontSize: 11 }}>
                  No pieces left — this round was auto-passed for you.
                </div>
              )}
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
                {gameState ? `${gameState.players[opIndex]?.name ?? "Opponent"} — Team ${TEAM_NAME[opIndex]}` : `Opponent — Team ${TEAM_NAME[opIndex]}`}
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
              {gameState?.over && hasNoPlayableMove(gameState.players[opIndex]) && (
                <div className="notice mt8" style={{ fontSize: 11 }}>
                  {gameState.players[opIndex].name} has no pieces left and points too low to buy more.
                </div>
              )}
            </div>

            <div className="log" id="glog">
              {(gameState?.log ?? [{ msg: "Game started!" }]).map((entry, index) => (
                <p key={`${entry.msg}-${index}`}>{entry.msg}</p>
              ))}
            </div>
          </div>

          <div className="ba">
            <div className="sbar" id="sbar">
              <span className="pulse" id="sbar-pulse" style={{ display: gameState && !gameState.moves[myIndex]?.done ? "inline-block" : "none" }} />
              <span id="sbar-txt">
                {gameState?.over
                  ? "Game Over!"
                  : !gameState
                    ? "Syncing board…"
                    : !gameState.moves[myIndex]?.done
                      ? pending.piece && pending.cell !== null
                        ? "Ready! Click Lock In to submit."
                        : "Pick a piece, then click a square."
                      : !gameState.moves[opIndex]?.done
                        ? `Move locked – waiting for ${gameState.players[opIndex]?.name ?? "opponent"}…`
                        : "Resolving round…"}
              </span>
              <span className="mla" style={{ fontSize: 12, color: "var(--text3)" }} id="rnd-lbl">
                Round {gameState?.round ?? 1}
                {room ? ` · ${room.code}` : ""}
              </span>
            </div>

            <div className="lgd">
              <div className="li">
                <div className="lb" style={{ background: "var(--p1bg)", border: "1px solid var(--p1b)" }} />
                Team Green {gameState ? `(${gameState.players[0].name})` : ""}
              </div>
              <div className="li">
                <div className="lb" style={{ background: "var(--p2bg)", border: "1px solid var(--p2b)" }} />
                Team Purple {gameState ? `(${gameState.players[1].name})` : ""}
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

            <div className="mt12 flex" style={{ gap: 8, flexWrap: "wrap" }}>
              {!gameState ? (
                <div style={{ fontSize: 12, color: "var(--text2)" }}>
                  Syncing with the room <strong>{room?.code ?? session?.code}</strong>…
                </div>
              ) : !gameState.moves[myIndex]?.done && pending.piece && pending.cell !== null ? (
                <button className="btn btnp" onClick={submitMove}>
                  Lock In move
                </button>
              ) : null}
              {gameState && !gameState.moves[myIndex]?.done && pending.piece && pending.cell !== null && (
                <button className="btn" onClick={() => setPending({ piece: null, cell: null })}>
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`wov ${gameState?.over ? "on" : ""}`}>
        <div className="wc">
          <h2>
            {gameState && gameState.players[0].pts > gameState.players[1].pts
              ? `${gameState.players[0].name} (Team Green) wins!`
              : gameState && gameState.players[1].pts > gameState.players[0].pts
                ? `${gameState.players[1].name} (Team Purple) wins!`
                : "It's a tie!"}
          </h2>
          <p>
            {gameState
              ? `${gameState.players[0].name} (Green): ${gameState.players[0].pts} pts\n${gameState.players[1].name} (Purple): ${gameState.players[1].pts} pts`
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