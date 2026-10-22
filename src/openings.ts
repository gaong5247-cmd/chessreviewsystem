import {Chess} from "chess.js";
import type {Game,Ply} from "./types";

type Opening = {eco:string;name:string;line:string};
const LINES:Opening[] = [
  {eco:"B00",name:"King's Pawn Opening",line:"e4"},
  {eco:"A40",name:"Queen's Pawn Opening",line:"d4"},
  {eco:"A10",name:"English Opening",line:"c4"},
  {eco:"A04",name:"Réti Opening",line:"Nf3"},
  {eco:"A00",name:"Bird Opening",line:"f4"},
  {eco:"C20",name:"King's Pawn Game",line:"e4 e5"},
  {eco:"B20",name:"Sicilian Defense",line:"e4 c5"},
  {eco:"B10",name:"Caro-Kann Defense",line:"e4 c6"},
  {eco:"C00",name:"French Defense",line:"e4 e6"},
  {eco:"B01",name:"Scandinavian Defense",line:"e4 d5"},
  {eco:"B07",name:"Pirc Defense",line:"e4 d6"},
  {eco:"B06",name:"Modern Defense",line:"e4 g6"},
  {eco:"B02",name:"Alekhine Defense",line:"e4 Nf6"},
  {eco:"C40",name:"King's Knight Opening",line:"e4 e5 Nf3"},
  {eco:"C44",name:"King's Pawn Game: Four Knights setup",line:"e4 e5 Nf3 Nc6"},
  {eco:"C50",name:"Italian Game",line:"e4 e5 Nf3 Nc6 Bc4"},
  {eco:"C54",name:"Italian Game: Giuoco Piano",line:"e4 e5 Nf3 Nc6 Bc4 Bc5"},
  {eco:"C55",name:"Two Knights Defense",line:"e4 e5 Nf3 Nc6 Bc4 Nf6"},
  {eco:"C60",name:"Ruy Lopez",line:"e4 e5 Nf3 Nc6 Bb5"},
  {eco:"C65",name:"Ruy Lopez: Berlin Defense",line:"e4 e5 Nf3 Nc6 Bb5 Nf6"},
  {eco:"C70",name:"Ruy Lopez: Morphy Defense",line:"e4 e5 Nf3 Nc6 Bb5 a6"},
  {eco:"C80",name:"Ruy Lopez: Open Variation",line:"e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4"},
  {eco:"C88",name:"Ruy Lopez: Closed",line:"e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"},
  {eco:"C42",name:"Petrov Defense",line:"e4 e5 Nf3 Nf6"},
  {eco:"C30",name:"King's Gambit",line:"e4 e5 f4"},
  {eco:"C23",name:"Bishop's Opening",line:"e4 e5 Bc4"},
  {eco:"C45",name:"Scotch Game",line:"e4 e5 Nf3 Nc6 d4"},
  {eco:"C47",name:"Four Knights Game",line:"e4 e5 Nf3 Nc6 Nc3 Nf6"},
  {eco:"C46",name:"Three Knights Game",line:"e4 e5 Nf3 Nc6 Nc3"},
  {eco:"B30",name:"Sicilian Defense: Old Sicilian",line:"e4 c5 Nf3 Nc6"},
  {eco:"B50",name:"Sicilian Defense: Modern",line:"e4 c5 Nf3 d6"},
  {eco:"B90",name:"Sicilian Defense: Najdorf Variation",line:"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"},
  {eco:"B70",name:"Sicilian Defense: Dragon Variation",line:"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6"},
  {eco:"B33",name:"Sicilian Defense: Sveshnikov",line:"e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5"},
  {eco:"B12",name:"Caro-Kann: Advance Variation",line:"e4 c6 d4 d5 e5"},
  {eco:"B15",name:"Caro-Kann: Main Line",line:"e4 c6 d4 d5 Nc3 dxe4 Nxe4"},
  {eco:"C02",name:"French Defense: Advance",line:"e4 e6 d4 d5 e5"},
  {eco:"C11",name:"French Defense: Classical",line:"e4 e6 d4 d5 Nc3 Nf6"},
  {eco:"A45",name:"Indian Game",line:"d4 Nf6"},
  {eco:"D00",name:"Queen's Pawn Game",line:"d4 d5"},
  {eco:"D06",name:"Queen's Gambit",line:"d4 d5 c4"},
  {eco:"D20",name:"Queen's Gambit Accepted",line:"d4 d5 c4 dxc4"},
  {eco:"D30",name:"Queen's Gambit Declined",line:"d4 d5 c4 e6"},
  {eco:"D35",name:"QGD: Exchange Variation",line:"d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5"},
  {eco:"D10",name:"Slav Defense",line:"d4 d5 c4 c6"},
  {eco:"D15",name:"Semi-Slav Defense",line:"d4 d5 c4 c6 Nc3 Nf6 Nf3 e6"},
  {eco:"D70",name:"Grünfeld Defense",line:"d4 Nf6 c4 g6 Nc3 d5"},
  {eco:"E60",name:"King's Indian Defense",line:"d4 Nf6 c4 g6 Nc3 Bg7"},
  {eco:"E20",name:"Nimzo-Indian Defense",line:"d4 Nf6 c4 e6 Nc3 Bb4"},
  {eco:"E10",name:"Queen's Indian Defense",line:"d4 Nf6 c4 e6 Nf3 b6"},
  {eco:"A84",name:"Dutch Defense",line:"d4 f5"},
  {eco:"A46",name:"Torre Attack",line:"d4 Nf6 Nf3 e6 Bg5"},
  {eco:"A80",name:"Dutch Defense",line:"d4 f5"},
  {eco:"A20",name:"English: King's English",line:"c4 e5"},
  {eco:"A30",name:"English: Symmetrical",line:"c4 c5"},
  {eco:"A05",name:"Réti: King's Indian Attack",line:"Nf3 Nf6 g3"},
  {eco:"A07",name:"King's Indian Attack",line:"Nf3 d5 g3"},
  {eco:"A01",name:"Larsen's Opening",line:"b3"},
  {eco:"D02",name:"London System",line:"d4 d5 Nf3 Nf6 Bf4"},
  {eco:"A48",name:"London System",line:"d4 Nf6 Nf3 g6 Bf4"},
  {eco:"B22",name:"Sicilian: Alapin Variation",line:"e4 c5 c3"}
];
const OPENING_LINES = LINES.map(o => ({...o,moves:o.line.split(" ")}));
export function identifyOpening(sans:string[],headers:Record<string,string>) {
  let winner:Opening|null=null;
  let bookPlies=0;
  for(const line of OPENING_LINES) {
    if(line.moves.length > sans.length) continue;
    if(line.moves.every((san,i)=>san.replace(/0/g,"O") === sans[i].replace(/0/g,"O"))) {
      if(line.moves.length > bookPlies) {bookPlies=line.moves.length;winner=line;}
    }
  }
  const headerName=headers.Opening || headers.ECOUrl?.split("/").pop()?.replace(/-/g," ") || "";
  return {opening:winner?.name||headerName||"Unclassified opening",eco:winner?.eco||headers.ECO||"—",bookPlies};
}
export function loadGame(pgn:string):Game {
  const chess=new Chess();
  chess.loadPgn(pgn,{strict:false});
  const headers=chess.header() as Record<string,string>;
  if(headers.Variant && !["Standard","Chess"].includes(headers.Variant)) throw new Error("Standard Chess PGN only (variants are not supported)");
  const history=chess.history({verbose:true});
  if(history.length===0) throw new Error("The PGN has no legal moves");
  const start=headers.FEN||new Chess().fen();
  const replay=new Chess(start);
  const fens=[replay.fen()];
  const plies:Ply[]=history.map((move,i)=>{
    replay.move(move.san);
    fens.push(replay.fen());
    return {san:move.san,uci:move.from+move.to+(move.promotion||""),from:move.from,to:move.to,promotion:move.promotion,color:move.color,fen:replay.fen(),moveNumber:Math.floor(i/2)+1};
  });
  const details=identifyOpening(plies.map(p=>p.san),headers);
  return {headers,plies,fens,...details};
}
export function uciToSan(fen:string,uci:string):string {
  if(!uci || uci.length < 4)return "—";
  try {
    const chess=new Chess(fen);
    return chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.slice(4,5)||"q"})?.san||uci;
  }catch{return uci;}
}
