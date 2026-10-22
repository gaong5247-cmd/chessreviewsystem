export type Grade = "brilliant" | "great" | "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "miss" | "blunder";
export type EngineLine = {rank:number; depth:number; nodes:number; cp:number|null; mate:number|null; pv:string[]};
export type PositionAnalysis = {index:number;fen:string;lines:EngineLine[];bestMove:string|null};
export type Progress = {index:number;total:number;position:PositionAnalysis};
export type Settings = {timeMs:number;depth:number;nodes:number;threads:number;hashMb:number;multiPv:number;enginePath:string;showArrow:boolean;flipBoard:boolean};
export type Ply = {san:string;uci:string;from:string;to:string;promotion?:string; color:"w"|"b";fen:string;moveNumber:number};
export type Game = {headers:Record<string,string>; plies:Ply[]; fens:string[]; opening:string; eco:string; bookPlies:number;};
export type AnnotatedMove = {grade:Grade; loss:number; acpl:number; expectedBefore:number; expectedAfter:number; bestUci:string; bestSan:string; sacrifice:boolean; soleMove:boolean;};
export const DEFAULT_SETTINGS:Settings = {
  timeMs:500, depth:18, nodes:2000000, threads:2, hashMb:128, multiPv:2,
  enginePath:"", showArrow:true, flipBoard:false
};
export const GRADE_META:Record<Grade,{title:string;glyph:string;color:string;description:string}> = {
  brilliant:{title:"Brilliant",glyph:"!!",color:"#43c7c6",description:"엔진이 인정한 좋은 기물 희생이자 중요한 수예요."},
  great:{title:"Great",glyph:"!",color:"#66aaf8",description:"놓쳤다면 큰 차이가 났을 중요한 수예요."},
  best:{title:"Best move",glyph:"★",color:"#8bd6a8",description:"엔진의 1순위 추천 수와 일치해요."},
  excellent:{title:"Excellent",glyph:"✓",color:"#92cda1",description:"최선과 거의 차이가 없어요."},
  good:{title:"Good",glyph:"✓",color:"#b0c6a4",description:"충분히 좋은 선택이에요."},
  book:{title:"Book move",glyph:"▤",color:"#b8a3d8",description:"오프닝 데이터에 수록된 정석 수예요."},
  inaccuracy:{title:"Inaccuracy",glyph:"?!",color:"#eac577",description:"조금 더 정확한 수가 있었어요."},
  mistake:{title:"Mistake",glyph:"?",color:"#eb9b63",description:"상대에게 유리한 기회를 준 수예요."},
  miss:{title:"Miss",glyph:"○",color:"#eead71",description:"상대의 실수를 제대로 이용하지 못했어요."},
  blunder:{title:"Blunder",glyph:"??",color:"#ee777a",description:"결정적인 평가 손실이 발생했어요."}
};
