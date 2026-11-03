// 即時層：Socket.io 事件處理（docs/PRD.md §7.5）
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { ClientToServer, ServerToClient } from '@cc/shared';
import type { Config } from './config';
import { Limiter } from './limiter';
import { moderate, Moderation } from './moderation';
import { publicPax, type Emit } from './rooms/Room';
import { RoomManager } from './rooms/RoomManager';
import { Sessions } from './sessions';
import { handleTicketRoutes } from './ticket/routes';
import { TicketSigner } from './ticket/ticket';

interface SocketData {
  pid?: string;
  roomId?: string;
  sid?: string;
}

const BoardReq = z.object({
  sid: z.string().min(8).max(64),
  resumeToken: z.string().max(1024).nullable(),
  line: z.enum(['CX', 'RV', 'SK']),
  avatar: z.enum(['office', 'student', 'hoodie', 'headphone']),
  passCard: z.enum(['tile', 'boba', 'ricecooker', 'mangoice']),
});
const StateReq = z.object({ state: z.enum(['idle', 'coffee', 'music', 'read', 'sleep']) });
const GlowReq = z.object({ to: z.string().max(32), kind: z.enum(['coffee', 'cheer']) });
const NoteReq = z.object({ text: z.string().max(200) });
const NidReq = z.object({ nid: z.string().max(32) });
const PrefReq = z.object({ dnd: z.boolean() });

const BAD = { ok: false, code: 'BAD_REQUEST' } as const;
const LIMITED = { ok: false, code: 'RATE_LIMITED' } as const;

export interface RealtimeServer {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient, {}, SocketData>;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function createRealtimeServer(cfg: Config): RealtimeServer {
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...rooms.stats() }));
      return;
    }
    handleTicketRoutes(req, res, tickets, limiter)
      .then(handled => {
        if (!handled) res.writeHead(404).end();
      })
      .catch(err => {
        console.error('[http]', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  const io = new Server<ClientToServer, ServerToClient, {}, SocketData>(http, {
    transports: ['websocket'],
    perMessageDeflate: false, // 訊息都很小，壓縮反而浪費 CPU
    cors: { origin: cfg.webOrigin },
  });

  const emitTo = (roomId: string): Emit => (event, ...args) => io.to(roomId).emit(event, ...args);
  const rooms = new RoomManager(cfg, emitTo);
  const limiter = new Limiter();
  const moderation = new Moderation();
  const sessions = new Sessions(cfg.tokenSecret);
  const tickets = new TicketSigner(cfg.tokenSecret);
  const sweeper = setInterval(() => limiter.sweep(), 10 * 60_000);

  io.on('connection', socket => {
    const current = () => {
      const room = rooms.get(socket.data.roomId);
      const pax = room?.pax.get(socket.data.pid ?? '');
      return room && pax ? { room, pax } : null;
    };

    socket.on('board', async (raw, ack) => {
      const req = BoardReq.safeParse(raw);
      if (!req.success || socket.data.pid) return ack(BAD);
      const { sid, resumeToken, line, avatar } = req.data;
      if (!limiter.take(`board:${sid}`, 5, 60_000)) return ack(LIMITED);

      // 座位還保留就復位（同一個 sid、仍在寬限內）
      const claims = sessions.verify(resumeToken);
      let room = claims && claims.sid === sid ? rooms.get(claims.roomId) : undefined;
      let pax = room && claims ? room.resume(claims.pid, sid) : null;
      if (!room || !pax) {
        room = rooms.assign(line);
        pax = room.seatHuman(sid, avatar);
        socket.to(room.id).emit('pax:join', { ...publicPax(pax), via: 'gangway' });
      }
      socket.data = { pid: pax.pid, roomId: room.id, sid };
      await socket.join(room.id);
      const token = sessions.issue({ sid, pid: pax.pid, roomId: room.id });
      ack({ ok: true, data: room.snapshotFor(pax, token) });
    });

    socket.on('state:set', (raw, ack) => {
      const req = StateReq.safeParse(raw);
      const ctx = current();
      if (!req.success || !ctx) return ack(BAD);
      if (!limiter.take(`state:${ctx.pax.pid}`, 12, 60_000)) return ack(LIMITED);
      ctx.room.setState(ctx.pax.pid, req.data.state, false);
      socket.to(ctx.room.id).emit('pax:state', { pid: ctx.pax.pid, state: ctx.pax.state, since: ctx.pax.since });
      ack({ ok: true });
    });

    socket.on('glow:send', (raw, ack) => {
      const req = GlowReq.safeParse(raw);
      const ctx = current();
      if (!req.success || !ctx) return ack(BAD);
      const { pid } = ctx.pax;
      const allowed =
        limiter.take(`glow:${pid}`, 10, 60_000) && limiter.take(`glow:${pid}>${req.data.to}`, 1, 120_000);
      if (!allowed) return ack(LIMITED);
      const target = ctx.room.pax.get(req.data.to);
      if (!target || target.pid === pid) return ack({ ok: false, code: 'NO_TARGET' });
      // 廣播不帶送出者；送出者自己的動畫由用戶端在 ack 後播放，所以排除送出者
      if (!target.dnd) socket.to(ctx.room.id).emit('glow', { to: target.pid, kind: req.data.kind, at: Date.now() });
      ack({ ok: true }); // 對方開勿擾時仍回成功，送出者不會感覺被拒絕
    });

    socket.on('note:write', (raw, ack) => {
      const req = NoteReq.safeParse(raw);
      const ctx = current();
      if (!req.success || !ctx) return ack(BAD);
      if (moderation.notesPaused) return ack({ ok: false, code: 'NOTES_PAUSED' });
      const sid = socket.data.sid!;
      // 嘗試次數另計：被過濾的句子不該吃掉「每 10 分鐘 3 則」的額度，但也不能無限試探詞庫
      if (!limiter.take(`note-try:${sid}`, 10, 10 * 60_000)) return ack(LIMITED);
      if (!ctx.room.canWriteNote(ctx.pax.pid)) return ack(LIMITED);

      const verdict = moderate(req.data.text);
      if (!verdict.ok) return ack({ ok: false, code: verdict.reason === 'care' ? 'CARE' : 'FILTERED' });
      if (!limiter.take(`note:${sid}`, 3, 10 * 60_000)) return ack(LIMITED);

      const { authorSid: _sid, timer: _timer, ...note } = ctx.room.addNote(ctx.pax.pid, sid, verdict.text);
      if (moderation.isMuted(sid)) socket.emit('note:new', note);
      else io.to(ctx.room.id).emit('note:new', note);
      ack({ ok: true, data: { nid: note.nid } });
    });

    socket.on('note:report', (raw, ack) => {
      const req = NidReq.safeParse(raw);
      const ctx = current();
      if (!req.success || !ctx) return ack(BAD);
      if (!limiter.take(`report:${socket.data.sid}`, 10, 3_600_000)) return ack(LIMITED);
      const note = ctx.room.note(req.data.nid);
      if (!note) return ack({ ok: false, code: 'NO_TARGET' });
      if (moderation.report(note.nid, socket.data.sid!)) {
        ctx.room.dropNote(note.nid);
        moderation.forget(note.nid);
        moderation.mute(note.authorSid);
        io.to(ctx.room.id).emit('note:gone', { nid: note.nid });
      }
      ack({ ok: true });
    });

    socket.on('pref:set', (raw, ack) => {
      const req = PrefReq.safeParse(raw);
      const ctx = current();
      if (!req.success || !ctx) return ack(BAD);
      if (!limiter.take(`pref:${ctx.pax.pid}`, 12, 60_000)) return ack(LIMITED);
      ctx.pax.dnd = req.data.dnd;
      ack({ ok: true });
    });

    socket.on('clock:sync', (_t0, ack) => {
      if (typeof ack === 'function' && limiter.take(`clock:${socket.id}`, 10, 60_000)) ack(Date.now());
    });

    socket.on('disconnect', () => {
      const ctx = current();
      if (ctx) ctx.room.markAway(ctx.pax.pid);
    });
  });

  return {
    http,
    io,
    rooms,
    async close() {
      clearInterval(sweeper);
      rooms.disposeAll();
      await new Promise<void>(resolve => io.close(() => resolve()));
    },
  };
}
