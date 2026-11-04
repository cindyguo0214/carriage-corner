// 車廂內的轉乘資訊指引（docs/PRD.md §23.3）：到站前 30 秒的跑馬燈、點頂部資訊列展開的完整站點圖
import { useEffect, useState } from 'react';
import { LINES, stationIsUnderground, type LineDef } from '@cc/shared';
import { actions, useApp } from '../store';

/** 到站前幾毫秒開始跑跑馬燈 */
const TICKER_LEAD_MS = 30_000;

const transferText = (line: LineDef, index: number) =>
  (line.stations[index].transfer ?? []).map(id => `${LINES[id].zh} ${id}`).join('、');

/** 車廂頂部的動態跑馬燈：「下一站：中央站。本站可轉乘 河岸線 RV ❯」 */
export function Ticker() {
  const scene = useApp(s => s.scene);
  const train = useApp(s => s.train);
  const lineId = useApp(s => s.line);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = train.arriveAt - now;
  if (scene !== 'carriage' || train.phase !== 'run' || left > TICKER_LEAD_MS || left <= 0) return null;
  const line = LINES[lineId];
  const next = line.stations[train.to];
  const transfer = transferText(line, train.to);
  const zh = `下一站：${next.zh}。${transfer ? `本站可轉乘 ${transfer} ❯` : ''}`;
  const en = `Next: ${next.en}.${next.transfer?.length ? ` Transfer to ${next.transfer.map(id => `${LINES[id].en} ${id}`).join(', ')}.` : ''}`;
  return (
    <div className="ticker" role="status" aria-label={zh}>
      <span className="ticker__lamp" style={{ background: line.color }} aria-hidden />
      <div className="ticker__track" aria-hidden>
        <span className="ticker__text">
          {zh}　{en}
        </span>
      </div>
    </div>
  );
}

/** 完整簡易站點圖：每一站的轉乘路線、地下／高架，以及列車現在的位置 */
export function RouteMap() {
  const open = useApp(s => s.ui.routeOpen);
  const scene = useApp(s => s.scene);
  const lineId = useApp(s => s.line);
  const train = useApp(s => s.train);
  const night = useApp(s => s.mode === 'night');
  if (!open || scene !== 'carriage') return null;
  const line = LINES[lineId];
  const dir = train.to > train.from ? 1 : -1;
  const close = () => actions.setUi({ routeOpen: false });
  return (
    <>
      <div className="pointer-events-auto fixed inset-0" aria-hidden onClick={close} />
      <section className={`route-map ${night ? 'route-map--night' : ''}`} aria-label={`${line.zh}站點圖`}>
        <header className="route-map__head">
          <span className="route-map__badge" style={{ background: line.color }}>{line.id}</span>
          <b>{line.zh}</b>
          <span className="route-map__dir">往 {line.stations[dir === 1 ? line.stations.length - 1 : 0].zh}</span>
          <button className="route-map__close" aria-label="收起站點圖" onClick={close}>✕</button>
        </header>
        <ol className="route-map__list" style={{ ['--line' as string]: line.color }}>
          {line.stations.map((st, i) => {
            const passed = dir === 1 ? i < train.to : i > train.to;
            const here = train.phase === 'dwell' && i === train.to;
            const next = train.phase === 'run' && i === train.to;
            return (
              <li key={st.code} className={`route-map__stop ${passed ? 'is-passed' : ''} ${here || next ? 'is-next' : ''}`}>
                <i className="route-map__dot" aria-hidden />
                <span className="route-map__name">
                  {st.zh}
                  <small>{st.en}</small>
                </span>
                {(here || next) && <span className="route-map__now">{here ? '到站' : '下一站'}</span>}
                {st.transfer?.map(id => (
                  <span key={id} className="route-map__xfer" style={{ background: LINES[id].color }} title={`可轉乘${LINES[id].zh}`}>
                    轉 {id} {LINES[id].zh}
                  </span>
                ))}
                <span className="route-map__seg">{stationIsUnderground(line, i) ? '地下' : '高架'}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
