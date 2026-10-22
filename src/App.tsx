import {useCallback,useEffect,useMemo,useState} from "react";
import type {CSSProperties,ChangeEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {Chess} from "chess.js";
import {
 Activity,ArrowDownToLine,BookOpen,Check,ChevronLeft,ChevronRight,Clock3,
 ClipboardPaste,Download,ExternalLink,FolderOpen,Gauge,Globe,Info,
 ListChecks,LoaderCircle,Play,RefreshCw,Settings2,ShieldCheck,Sparkles,
 Target,Upload,X,Zap
} from "lucide-react";
import {loadGame,uciToSan} from "./openings";
import {annotate,explanation,gradeColor,lineCp,orderedGrades,summary,winPercent} from "./review";
import {DEFAULT_SETTINGS,GRADE_META} from "./types";
import type {AnnotatedMove,Game,Grade,PositionAnalysis,Progress,Settings} from "./types";

const DEMO_PGN =
  '[Event "Sample review"]\n[Site "Chess Review System"]\n[Date "2026.10.22"]\n[Round "-"]\n[White "White"]\n[Black "Black"]\n[Result "*"]\n\n' +
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 ' +
  '6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 *';
type RemoteGame = {id:string;title:string;url:string;pgn:string};
type ImportMode = "pgn"|"lichess-user"|"lichess-link"|"chesscom-user";
type InfoTab = "review"|"moves";

function fmt(n:number|null|undefined,digits=1) {
 return n===null||n===undefined?"—":n.toFixed(digits);
}
function formatEval(position?:PositionAnalysis):string {
 const line=position?.lines.find(l=>l.rank===1)||position?.lines[0];
 if(!line)return "0.0";
 if(line.mate!==null&&line.mate!==undefined)return "#"+(line.mate<0?"−":"")+Math.abs(line.mate);
 if(line.cp===null||line.cp===undefined)return "—";
 return (line.cp>=0?"+":"")+(line.cp/100).toFixed(2);
}
function fmtNum(n:number) {return new Intl.NumberFormat("en-US").format(n);}
function arrowCoords(uci:string,flipped:boolean) {
 if(uci.length<4)return null;
 const square=(v:string)=>{
  const col=v.charCodeAt(0)-97,rank=Number(v[1])-1;
  if(col<0||col>7||rank<0||rank>7)return null;
  return {x:(flipped?7-col:col)*100+50,y:(flipped?rank:7-rank)*100+50};
 };
 const a=square(uci.slice(0,2)),b=square(uci.slice(2,4));
 return a&&b?{a,b}:null;
}
const GLYPHS:Record<string,string>={
 wk:"♔",wq:"♕",wr:"♖",wb:"♗",wn:"♘",wp:"♙",
 bk:"♚",bq:"♛",br:"♜",bb:"♝",bn:"♞",bp:"♟"
};
function Board({fen,flipped,lastMove,bestArrow,grade}:{
 fen:string;flipped:boolean;lastMove?:{from:string;to:string};bestArrow?:string;grade?:Grade;
}) {
 const chess=useMemo(()=>new Chess(fen),[fen]);
 const cells=chess.board();
 const files=flipped?["h","g","f","e","d","c","b","a"]:["a","b","c","d","e","f","g","h"];
 const rows=flipped?[...cells].reverse().map(r=>[...r].reverse()):cells;
 const arrow=bestArrow?arrowCoords(bestArrow,flipped):null;
 return <div className="board-shell">
   <div className="board-grid">
    {rows.map((rank,row)=>rank.map((piece,col)=>{
      const name=files[col]+(flipped?row+1:8-row);
      const highlight=lastMove&&(name===lastMove.from||name===lastMove.to);
      const atDestination=lastMove&&name===lastMove.to;
      return <div className={"board-square "+((row+col)%2===0?"light":"dark")+(highlight?" highlight":"")} key={name}>
        {col===0&&<span className="sq-rank">{flipped?row+1:8-row}</span>}
        {row===7&&<span className="sq-file">{files[col]}</span>}
        {piece&&<span className={"chess-piece "+(piece.color==="w"?"white-piece":"black-piece")}>{GLYPHS[piece.color+piece.type]}</span>}
        {atDestination&&grade&&<span className="board-grade" style={{background:GRADE_META[grade].color}}>{GRADE_META[grade].glyph}</span>}
      </div>;
    }))}
   </div>
   {arrow&&<svg className="board-arrows" viewBox="0 0 800 800" aria-label="Engine best move arrow">
    <defs><marker id="move-head" markerWidth="5" markerHeight="5" refX="2.8" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#ffb84e"/></marker></defs>
    <line x1={arrow.a.x} y1={arrow.a.y} x2={arrow.b.x} y2={arrow.b.y}
       stroke="#f0aa43" strokeWidth="13" strokeLinecap="round" strokeOpacity=".84" markerEnd="url(#move-head)"/>
   </svg>}
 </div>;
}
function EvalBar({position}: {position?:PositionAnalysis}) {
 const score=lineCp(position?.lines.find(l=>l.rank===1)||position?.lines[0]);
 const white=score===null?50:Math.min(97,Math.max(3,winPercent(score)));
 return <div className="eval-rail" aria-label="White evaluation advantage">
   <div className="eval-black" style={{height:(100-white)+"%"}}/>
   <div className="eval-white" style={{height:white+"%"}}/>
   <span className={"eval-number "+(score!==null&&score<0?"top":"bottom")}>{formatEval(position)}</span>
 </div>;
}
function EvalChart({game,analyses,selected,onSelect}:{
 game:Game;analyses:Record<number,PositionAnalysis>;selected:number;onSelect:(n:number)=>void;
}) {
 const values=game.fens.map((_,i)=>{
  const row=analyses[i]?.lines.find(l=>l.rank===1)||analyses[i]?.lines[0];
  const v=lineCp(row);
  return v===null?null:winPercent(v);
 });
 const points=values.map((v,i)=>v===null?null:{x:12+i/(Math.max(1,values.length-1))*476,y:104-v*0.88})
   .filter((p):p is {x:number;y:number}=>p!==null);
 const poly=points.map(p=>p.x+","+p.y).join(" ");
 const indicatorX=12+selected/Math.max(1,game.plies.length)*476;
 const selectedY=values[selected]===null?60:104-(values[selected]??50)*0.88;
 return <div className="chart-wrap">
   <svg viewBox="0 0 500 120" role="img" aria-label="Evaluation by move"
     onClick={e=>{
      const rect=e.currentTarget.getBoundingClientRect();
      const portion=(e.clientX-rect.left)/rect.width;
      onSelect(Math.max(0,Math.min(game.plies.length,Math.round(portion*game.plies.length))));
     }}>
      <rect x="12" y="10" width="476" height="95" rx="7" fill="#18232c"/>
      <path d="M12 60H488" stroke="#445260" strokeDasharray="4 6"/>
      <path d="M12 31H488M12 88H488" stroke="#2a3945" strokeDasharray="3 6"/>
      {points.length>1&&<polyline points={poly} stroke="#99d8b3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" fill="none"/>}
      <line x1={indicatorX} y1="10" x2={indicatorX} y2="106" stroke="#e8b96b" strokeWidth="2"/>
      <circle cx={indicatorX} cy={selectedY} r="4.5" fill="#e8b96b" stroke="#17242b" strokeWidth="2"/>
      <text x="12" y="117" className="chart-label">시작</text>
      <text x="485" y="117" textAnchor="end" className="chart-label">종료</text>
     </svg>
     {points.length===0&&<div className="chart-placeholder">분석 완료 후 그래프가 표시돼요</div>}
 </div>;
}
function StatPlayer({name,accuracy,acpl,side}:{
 name:string;accuracy:number|null;acpl:number|null;side:"w"|"b";
}) {
 return <div className="player-stat">
    <div className={"player-avatar "+(side==="w"?"avatar-white":"avatar-black")}>{side==="w"?"♔":"♚"}</div>
    <div className="player-meta"><strong>{name}</strong><span>{side==="w"?"White":"Black"}</span></div>
    <div className="player-numbers"><strong>{accuracy===null?"—":fmt(accuracy)+"%"}</strong><small>정확도 추정</small></div>
    <div className="player-numbers acpl"><strong>{fmt(acpl,0)}</strong><small>ACPL 추정</small></div>
 </div>;
}
function GradesTable({game,notes}: {game:Game;notes:Array<AnnotatedMove|null>}) {
 const data=summary(game,notes);
 return <div className="grades-list">
  <div className="grade-head"><span>수 분류</span><span>백</span><span>흑</span></div>
  {orderedGrades.map(grade=><div className="grade-stat" key={grade}>
     <span className="grade-name"><span style={{color:gradeColor(grade)}}>{GRADE_META[grade].glyph}</span>{GRADE_META[grade].title}</span>
     <b>{data.white.counts[grade]||0}</b><b>{data.black.counts[grade]||0}</b>
  </div>)}
 </div>;
}
function NumericField({label,value,onChange,min,max,unit,hint}:{
 label:string;value:number;onChange:(v:number)=>void;min:number;max:number;unit?:string;hint?:string;
}) {
 return <label className="setting-field"><span>{label}</span>
   <div className="num-row"><input type="number" min={min} max={max} value={value}
    onChange={e=>onChange(Math.max(min,Math.min(max,Math.floor(Number(e.target.value)||min))))}/>
    {unit&&<small>{unit}</small>}</div>
   {hint&&<small className="setting-hint">{hint}</small>}
 </label>;
}
function SettingsModal({settings,onChange,onClose}:{
 settings:Settings;onChange:(s:Settings)=>void;onClose:()=>void;
}) {
 const patch=(key:keyof Settings,value:Settings[keyof Settings])=>onChange({...settings,[key]:value});
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
   <section className="modal-box settings-box" role="dialog" aria-modal="true" aria-label="Review settings">
    <header className="modal-heading"><div><span className="overline">ANALYSIS CONTROLS</span><h2>리뷰 설정</h2></div>
    <button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20}/></button></header>
    <p className="subtle">시간, 깊이, 노드 한도 중 먼저 도달하는 조건에서 탐색이 종료돼요. 1ms에서는 평가 데이터가 부족할 수 있어요.</p>
    <div className="setting-grid">
      <NumericField label="분석 시간" unit="ms" min={1} max={1000000} value={settings.timeMs} onChange={n=>patch("timeMs",n)} hint="1 ~ 1,000,000"/>
      <NumericField label="최대 깊이" unit="depth" min={1} max={50} value={settings.depth} onChange={n=>patch("depth",n)} hint="1 ~ 50"/>
      <NumericField label="최대 노드" unit="nodes" min={1} max={1000000000000} value={settings.nodes} onChange={n=>patch("nodes",n)} hint="1 ~ 1,000,000,000,000"/>
      <NumericField label="엔진 스레드" min={1} max={128} value={settings.threads} onChange={n=>patch("threads",n)}/>
      <NumericField label="해시 메모리" unit="MB" min={16} max={65536} value={settings.hashMb} onChange={n=>patch("hashMb",n)}/>
      <NumericField label="후보 수 (MultiPV)" min={2} max={5} value={settings.multiPv} onChange={n=>patch("multiPv",n)}/>
    </div>
    <label className="setting-field full-span"><span>외부 UCI 엔진 경로 (선택사항)</span>
      <input className="path-input" value={settings.enginePath} placeholder="비워두면 내장 Stockfish 19 사용"
       onChange={e=>patch("enginePath",e.target.value)}/></label>
    <label className="toggle-line"><input type="checkbox" checked={settings.showArrow} onChange={e=>patch("showArrow",e.target.checked)}/>
      수를 넘길 때 엔진 추천 화살표 표시</label>
    <div className="settings-foot"><span><ShieldCheck size={16}/> 분석은 내 컴퓨터에서 실행돼요</span>
      <button className="button primary" onClick={onClose}><Check size={17}/>설정 완료</button></div>
   </section>
 </div>;
}
function ImportModal({onClose,onLoad}:{
 onClose:()=>void;onLoad:(pgn:string)=>void;
}) {
 const [mode,setMode]=useState<ImportMode>("pgn");
 const [pgn,setPgn]=useState("");
 const [query,setQuery]=useState("");
 const [results,setResults]=useState<RemoteGame[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const tabs:{key:ImportMode;label:string}[]=[
  {key:"pgn",label:"PGN 붙여넣기"},{key:"lichess-link",label:"Lichess 링크"},
  {key:"lichess-user",label:"Lichess 계정"},{key:"chesscom-user",label:"Chess.com 계정"}
 ];
 const load=async()=>{
  setError("");setBusy(true);
  try {
   const games=await invoke<RemoteGame[]>("import_remote",{provider:mode,query});
   if(!games.length){setError("공개 기보를 찾지 못했어요.");return;}
   if(games.length===1){onLoad(games[0].pgn);return;}
   setResults(games);
  }catch(e){setError(String(e));}
  finally{setBusy(false);}
 };
 const onFile=async(e:ChangeEvent<HTMLInputElement>)=>{
  const file=e.target.files?.[0];if(file)setPgn(await file.text());
 };
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="modal-box import-box" role="dialog" aria-modal="true" aria-label="Import game">
   <header className="modal-heading"><div><span className="overline">IMPORT GAME</span><h2>기보 가져오기</h2></div>
     <button className="icon-button" onClick={onClose} aria-label="닫기"><X size={20}/></button></header>
   <div className="import-tabs">{tabs.map(tab=><button className={tab.key===mode?"active":""} key={tab.key} onClick={()=>{setMode(tab.key);setResults([]);setError("");}}>{tab.label}</button>)}</div>
   {mode==="pgn"?<>
     <div className="file-row"><span>PGN 텍스트를 붙여넣거나 파일을 불러오세요.</span>
       <label className="file-chooser"><FolderOpen size={15}/> .pgn 열기<input type="file" accept=".pgn,.txt" onChange={onFile}/></label></div>
     <textarea spellCheck={false} value={pgn} onChange={e=>setPgn(e.target.value)}
       placeholder={'[Event "My Game"]\n[White "Player A"]\n[Black "Player B"]\n\n1. e4 e5 2. Nf3 Nc6 ...'} rows={12}/>
     <div className="modal-actions"><button className="button primary" onClick={()=>onLoad(pgn)} disabled={!pgn.trim()}><Upload size={16}/>기보 열기</button></div>
   </>:<>
     <p className="subtle">{mode==="lichess-link"?"공개 Lichess 대국 주소를 붙여넣으세요.":mode==="lichess-user"?"Lichess 계정의 최근 공개 대국 최대 20개를 가져와요.":"Chess.com Public API의 최근 공개 기보를 가져와요. 로그인은 필요하지 않아요."}</p>
     <div className="remote-search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void load();}}
      placeholder={mode==="lichess-link"?"https://lichess.org/abcdefgh":"플레이어 사용자 이름"}/>
      <button className="button primary" disabled={busy||!query.trim()} onClick={()=>void load()}>{busy?<LoaderCircle className="spin" size={16}/>:<Globe size={16}/>}검색</button></div>
     {results.length>0&&<div className="remote-results">{results.map((entry,i)=><button key={entry.id+"-"+i} onClick={()=>onLoad(entry.pgn)}>
       <span><strong>{entry.title}</strong><small>{entry.url||"공개 대국"}</small></span><ChevronRight size={19}/></button>)}</div>}
   </>}
   {error&&<p className="error-text">{error}</p>}
   <p className="fineprint">공개 대국만 지원합니다. Chess.com 링크는 계정 이름으로 검색한 뒤 해당 게임을 선택하세요.</p>
  </section>
 </div>;
}

export default function App() {
 const [game,setGame]=useState<Game>(()=>loadGame(DEMO_PGN));
 const [settings,setSettings]=useState<Settings>(()=>{
   try{return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("crs-settings")||"{}")};}
   catch{return DEFAULT_SETTINGS;}
 });
 const [analyses,setAnalyses]=useState<Record<number,PositionAnalysis>>({});
 const [selected,setSelected]=useState(0);
 const [running,setRunning]=useState(false);
 const [progress,setProgress]=useState(0);
 const [modal,setModal]=useState<"settings"|"import"|null>(null);
 const [message,setMessage]=useState("");
 const [tab,setTab]=useState<InfoTab>("review");
 const [showHelp,setShowHelp]=useState(false);
 useEffect(()=>{localStorage.setItem("crs-settings",JSON.stringify(settings));},[settings]);
 useEffect(()=>{
  let unsub:(()=>void)|undefined,disposed=false;
  void listen<Progress>("review:progress",event=>{
    const {index,total,position}=event.payload;
    setAnalyses(old=>({...old,[index]:position}));
    setProgress(Math.round((index+1)/total*100));
  }).then(fn=>{if(disposed)fn();else unsub=fn;}).catch(()=>{});
  return ()=>{disposed=true;unsub?.();};
 },[]);
 const notes=useMemo(()=>annotate(game,analyses),[game,analyses]);
 const stats=useMemo(()=>summary(game,notes),[game,notes]);
 const currentAnalysis=analyses[selected];
 const currentNote=selected?notes[selected-1]:null;
 const currentPly=selected?game.plies[selected-1]:null;
 const isReviewed=stats.total===game.plies.length;
 const white=game.headers.White||"White",black=game.headers.Black||"Black";
 const select=useCallback((n:number)=>setSelected(Math.max(0,Math.min(game.plies.length,n))),[game.plies.length]);
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{
    const target=event.target as HTMLElement;
    if(modal||["INPUT","TEXTAREA"].includes(target?.tagName))return;
    if(event.key==="ArrowRight"){event.preventDefault();setSelected(n=>Math.min(n+1,game.plies.length));}
    if(event.key==="ArrowLeft"){event.preventDefault();setSelected(n=>Math.max(0,n-1));}
  };
  window.addEventListener("keydown",handler);
  return ()=>window.removeEventListener("keydown",handler);
 },[game.plies.length,modal]);
 const load=(pgn:string)=>{
  if(running){setMessage("진행 중인 리뷰를 먼저 중단하세요.");return;}
  try {
    const next=loadGame(pgn);
    setGame(next);setAnalyses({});setSelected(0);setProgress(0);setMessage("");
    setModal(null);setTab("review");
  } catch(e){setMessage("PGN을 불러오지 못했어요: "+String(e));}
 };
 const start=async()=>{
  setMessage("");setAnalyses({});setProgress(0);setRunning(true);
  try {
   const parameters={
     timeMs:settings.timeMs,depth:settings.depth,nodes:settings.nodes,
     threads:settings.threads,hashMb:settings.hashMb,multiPv:settings.multiPv,
     enginePath:settings.enginePath||null
   };
   const positions=game.fens;
   const all=await invoke<PositionAnalysis[]>("analyze_game",{positions,settings:parameters});
   const result:Record<number,PositionAnalysis>={};
   all.forEach(p=>{result[p.index]=p;});
   setAnalyses(result);setProgress(100);
   setMessage("리뷰 완료! 수별 평가와 추천 수를 확인해 보세요.");
  }catch(e){setMessage(String(e));}
  finally{setRunning(false);}
 };
 const stop=async()=>{try{await invoke("cancel_review");setMessage("리뷰 중지 요청을 보냈어요.");}catch(e){setMessage(String(e));}};
 const saveReport=()=>{
  const payload={
    program:"Chess Review System",version:"0.1.0",notice:"Independent Stockfish-based estimates, not Chess.com official classifications",
    date:new Date().toISOString(),headers:game.headers,opening:game.opening,settings,
    positions:game.fens,annotations:notes,analyses
  };
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="chess-review-"+Date.now()+".json";link.click();URL.revokeObjectURL(url);
 };
 const chartLine=currentAnalysis?.lines.find(l=>l.rank===1)||currentAnalysis?.lines[0];
 const engineSuggestion=currentAnalysis?.bestMove||chartLine?.pv[0]||"";
 return <div className="app-layout">
  <aside className="side-rail">
   <div className="brand-logo" title="Chess Review System">♜<span className="brand-spot"/></div>
   <div className="rail-divider"/>
   <button className="rail-btn active" title="Move Review" onClick={()=>setTab("review")}><ListChecks size={22}/></button>
   <button className="rail-btn" title="새 기보" disabled={running} onClick={()=>setModal("import")}><FolderOpen size={21}/></button>
   <button className="rail-btn" title="분석 결과" onClick={()=>setTab("moves")}><Activity size={21}/></button>
   <div className="rail-flex"/>
   <button className="rail-btn" title="설정" onClick={()=>setModal("settings")}><Settings2 size={21}/></button>
   <button className="rail-btn" title="도움말" onClick={()=>setShowHelp(s=>!s)}><Info size={21}/></button>
  </aside>
  <div className="workspace">
   <header className="topbar">
     <div className="header-brand"><strong>CHESS<span>REVIEW</span></strong><span className="header-divider"/> <span>Move Review Studio</span></div>
     <div className="header-right"><span className="engine-chip"><span className="green-dot"/> STOCKFISH 19</span>
       <button className="small-top-action" onClick={()=>setModal("import")} disabled={running}><Upload size={16}/> Import</button>
       <button className="icon-button" onClick={()=>setModal("settings")} title="설정"><Settings2 size={19}/></button>
     </div>
   </header>
   <main className="content-layout">
    <section className="board-column">
     <div className="board-heading">
      <div><span className="overline">ANALYSIS BOARD</span><h2>{white} <span className="versus">vs</span> {black}</h2></div>
      <button className="soft-button" onClick={()=>setSettings(s=>({...s,flipBoard:!s.flipBoard}))}><RefreshCw size={16}/> 보드 회전</button>
     </div>
     <div className="board-player top-player"><span className={"tiny-avatar "+(settings.flipBoard?"avatar-white":"avatar-black")}>{settings.flipBoard?"♔":"♚"}</span><strong>{settings.flipBoard?white:black}</strong><span className="player-side">{settings.flipBoard?"백":"흑"}</span></div>
     <div className="board-with-eval">
       <EvalBar position={currentAnalysis}/>
       <Board fen={game.fens[selected]} flipped={settings.flipBoard}
          lastMove={currentPly?{from:currentPly.from,to:currentPly.to}:undefined}
          grade={currentNote?.grade}
          bestArrow={settings.showArrow?engineSuggestion:undefined}/>
     </div>
     <div className="board-player bottom-player"><span className={"tiny-avatar "+(settings.flipBoard?"avatar-black":"avatar-white")}>{settings.flipBoard?"♚":"♔"}</span><strong>{settings.flipBoard?black:white}</strong><span className="player-side">{settings.flipBoard?"흑":"백"}</span></div>
     <div className="board-controls">
       <div className="arrow-controls">
         <button title="맨 처음" onClick={()=>select(0)}>❮❮</button>
         <button title="이전 수" onClick={()=>select(selected-1)}><ChevronLeft size={24}/></button>
         <span>{selected===0?"시작 위치":(Math.ceil(selected/2)+". "+(currentPly?.color==="b"?"... ":"")+(currentPly?.san||""))}</span>
         <button title="다음 수" onClick={()=>select(selected+1)}><ChevronRight size={24}/></button>
         <button title="마지막 수" onClick={()=>select(game.plies.length)}>❯❯</button>
       </div>
       <span className="key-hint">← → 방향키로 수 이동</span>
     </div>
     <div className="under-board-stats">
       <div><Target size={18}/><span>진행 수</span><strong>{selected}<small> / {game.plies.length}</small></strong></div>
       <div><Gauge size={18}/><span>평가</span><strong>{formatEval(currentAnalysis)}</strong></div>
       <div><BookOpen size={18}/><span>ECO</span><strong>{game.eco}</strong></div>
     </div>
    </section>
    <section className="review-column">
     <div className="review-main-head">
      <div><span className="overline">YOUR GAME, EXPLAINED</span><h1>Move Review <span className="head-star"><Sparkles size={22}/></span></h1>
      <p>Stockfish로 한 수씩 살펴보는 나만의 체스 리뷰</p></div>
      <button title="리뷰 설정" className="icon-button framed" onClick={()=>setModal("settings")}><Settings2 size={21}/></button>
     </div>
     <div className="opening-panel"><div className="opening-icon"><BookOpen size={22}/></div>
       <div><small>OPENING DETECTED</small><strong>{game.opening}</strong><span>{game.eco} · {game.bookPlies} half-moves matched</span></div>
       <span className="opening-pill">{game.eco}</span>
     </div>
     <div className="analysis-cta">
       <div className="cta-top"><div><span className="cta-icon"><Zap size={21}/></span><strong>{running?"분석 진행 중":isReviewed?"분석 완료":"전체 기보 정밀 리뷰"}</strong></div>
        <span className="runtime-label"><Clock3 size={14}/> {fmtNum(settings.timeMs)}ms · D{settings.depth} · {fmtNum(settings.nodes)} nodes</span></div>
       {running&&<div className="progress-track"><div style={{width:progress+"%"}}/></div>}
       <div className="cta-actions">
        <button className={"button "+(running?"danger":"primary")+" large"} onClick={()=>void(running?stop():start())}>
          {running?<X size={18}/>:isReviewed?<RefreshCw size={18}/>:<Play size={18} fill="currentColor"/>}
          {running?"분석 중지":isReviewed?"다시 리뷰하기":"리뷰 시작하기"}
        </button>
        <button className="button secondary" onClick={()=>setModal("settings")}><Settings2 size={17}/> 상세 설정</button>
       </div>
       {running&&<small className="cta-sub">분석된 위치 {Object.keys(analyses).length}/{game.fens.length} · {progress}%</small>}
       {message&&<p className={"status-message "+(message.includes("완료")?"success":"")}>{message}</p>}
     </div>
     <div className="panel-tabs">
       <button className={tab==="review"?"selected":""} onClick={()=>setTab("review")}><Sparkles size={16}/> 리뷰 요약</button>
       <button className={tab==="moves"?"selected":""} onClick={()=>setTab("moves")}><ListChecks size={16}/> 수별 분석</button>
       <button className="export-tab" onClick={saveReport}><Download size={16}/> JSON</button>
     </div>
     {tab==="review"?<div className="tab-body">
       <div className="section-label"><span>PLAYER PERFORMANCE</span><span className="tiny-info">독립적인 추정치</span></div>
       <div className="player-stat-box">
         <StatPlayer name={white} side="w" accuracy={stats.white.accuracy} acpl={stats.white.acpl}/>
         <div className="stat-separator"/>
         <StatPlayer name={black} side="b" accuracy={stats.black.accuracy} acpl={stats.black.acpl}/>
       </div>
       <div className="sub-panel chart-panel"><div className="panel-subhead"><div><Activity size={17}/><strong>Evaluation graph</strong></div>
        <span>{stats.total}/{game.plies.length} moves</span></div>
        <EvalChart game={game} analyses={analyses} selected={selected} onSelect={select}/>
       </div>
       <div className="sub-panel move-highlight">
         <div className="panel-subhead"><div><Sparkles size={17}/><strong>현재 수 분석</strong></div><span>{selected===0?"시작 위치":selected+" ply"}</span></div>
         <div className="move-highlight-main">
          <span className="move-san">{currentPly?.san||"—"}</span>
          {currentNote&&<span className="grade-badge" style={{color:gradeColor(currentNote.grade),background:gradeColor(currentNote.grade)+"20"}}>
            {GRADE_META[currentNote.grade].glyph} {GRADE_META[currentNote.grade].title}</span>}
          {!currentNote&&<span className="muted-text">수 선택 및 리뷰 필요</span>}
         </div>
         <p>{explanation(currentNote,currentPly?.san||"")}</p>
         <div className="recommend-line"><span>엔진 추천</span><strong>{selected>0?currentNote?.bestSan||"—":uciToSan(game.fens[0],analyses[0]?.bestMove||"")}</strong>
         <span>승리 기대값 손실</span><strong>{currentNote?fmt(currentNote.loss*100,2)+"%p":"—"}</strong></div>
       </div>
       <div className="sub-panel count-panel"><div className="panel-subhead"><div><Target size={17}/><strong>Move classifications</strong></div>
       <span>{isReviewed?"전체 리뷰":"분석 진행 중"}</span></div>
        <GradesTable game={game} notes={notes}/>
       </div>
     </div>:<div className="tab-body">
       <div className="section-label"><span>ANNOTATED MOVE LIST</span><span>{game.plies.length} half-moves</span></div>
       <div className="moves-list">
        {Array.from({length:Math.ceil(game.plies.length/2)},(_,i)=>{
         const w=game.plies[2*i],b=game.plies[2*i+1];
         return <div className="moves-row" key={i}>
          <span className="move-number">{i+1}.</span>
          {[w,b].map((p,j)=>{
           if(!p)return <span key={j}/>;
           const at=2*i+j+1, note=notes[at-1];
           return <button key={j} onClick={()=>select(at)} className={"move-cell "+(selected===at?"chosen":"")}>
             <span>{p.san}</span>{note&&<span className="move-mark" style={{color:gradeColor(note.grade)}}>{GRADE_META[note.grade].glyph}</span>}
           </button>;
          })}
         </div>;
        })}
       </div>
       <div className="sub-panel pv-panel"><div className="panel-subhead"><div><Activity size={17}/><strong>Engine principal variations</strong></div>
        <span>Depth {chartLine?.depth??"—"}</span></div>
        {currentAnalysis?.lines.length?currentAnalysis.lines.map(line=><div className="pv-line" key={line.rank}>
         <span className="pv-rank">{line.rank}</span><strong>{line.mate!==null?"M"+line.mate:line.cp===null?"—":(line.cp/100).toFixed(2)}</strong>
         <span>{line.pv.slice(0,8).join(" ")}</span>
        </div>):<p className="muted-placeholder">리뷰를 시작하면 후보 수와 PV가 나타나요.</p>}
       </div>
     </div>}
     <div className="review-footer"><ShieldCheck size={15}/> 모든 엔진 평가는 로컬에서 수행 · 독립 등급 분류 (Chess.com 공식 판정 아님)</div>
    </section>
   </main>
  </div>
  {modal==="settings"&&<SettingsModal settings={settings} onChange={setSettings} onClose={()=>setModal(null)}/>}
  {modal==="import"&&<ImportModal onClose={()=>setModal(null)} onLoad={load}/>}
  {showHelp&&<div className="help-popover"><button className="icon-button" onClick={()=>setShowHelp(false)}><X size={17}/></button>
      <h3>빠른 사용법</h3><p>① 기보를 붙여넣거나 온라인 계정에서 가져오세요.</p>
      <p>② 분석 시간, 깊이, 노드를 조절하세요.</p>
      <p>③ 리뷰 시작 버튼을 누르면 수별 평가가 진행돼요.</p>
      <p>④ ← → 키, 그래프, 수 목록으로 탐색하세요.</p>
      <a href="https://github.com/gaong5247-cmd/chessreviewsystem" target="_blank" rel="noreferrer">GitHub 저장소 <ExternalLink size={13}/></a>
    </div>}
 </div>;
}
