import {Chess} from "chess.js";
import {uciToSan} from "./openings";
import {GRADE_META} from "./types";
import type {Game,AnnotatedMove,Grade,PositionAnalysis} from "./types";

export function winPercent(cp:number):number {
  return 100/(1+Math.exp(-0.00368208 * Math.max(-20000,Math.min(20000,cp))));
}
export function lineCp(line:PositionAnalysis["lines"][number]|undefined):number|null {
  if(!line)return null;
  if(line.mate!==null && line.mate!==undefined) return Math.sign(line.mate)*(30000-Math.min(15000,Math.abs(line.mate)*100));
  return line.cp;
}
function material(fen:string,color:"w"|"b"):number {
  const board=new Chess(fen).board();
  const values:Record<string,number>={p:1,n:3.2,b:3.3,r:5.1,q:9.5,k:0};
  let total=0;
  for(const row of board)for(const cell of row)if(cell && cell.color===color)total+=values[cell.type]||0;
  return total;
}
function tryMove(chess:Chess,uci:string):boolean {
  if(uci.length<4)return false;
  try{return Boolean(chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.slice(4,5)||"q"}));}
  catch{return false;}
}
function sacrificeEvidence(game:Game,index:number,after:PositionAnalysis):boolean {
  const p=game.plies[index], parent=game.fens[index];
  const first=new Chess(parent);
  if(!tryMove(first,p.uci))return false;
  const reply=after.lines[0]?.pv?.[0];
  if(!reply)return false;
  if(!tryMove(first,reply))return false;
  const materialBefore=material(parent,p.color)-material(parent,p.color==="w"?"b":"w");
  const materialAfter=material(first.fen(),p.color)-material(first.fen(),p.color==="w"?"b":"w");
  // An actual >=minor-piece material concession after the opponent's best immediate reply.
  return materialAfter-materialBefore<=-2.8;
}
export function annotate(game:Game,analyses:Record<number,PositionAnalysis>):Array<AnnotatedMove|null> {
  return game.plies.map((move,index)=>{
    const before=analyses[index],after=analyses[index+1];
    if(!before||!after)return null;
    const best=before.lines.find(l=>l.rank===1)||before.lines[0];
    const chosen=after.lines.find(l=>l.rank===1)||after.lines[0];
    const bestCp=lineCp(best), playedCp=lineCp(chosen);
    if(bestCp===null||playedCp===null)return null;
    const factor=move.color==="w"?1:-1;
    const expectedBefore=winPercent(bestCp*factor)/100;
    const expectedAfter=winPercent(playedCp*factor)/100;
    const loss=Math.max(0,Math.min(1,expectedBefore-expectedAfter));
    const acpl=Math.max(0,Math.min(1000,(bestCp-playedCp)*factor));
    const bestUci=before.bestMove||best?.pv[0]||"";
    const bestPlayed=bestUci===move.uci;
    const second=before.lines.find(l=>l.rank===2);
    const secondCp=lineCp(second);
    const secondExpected=secondCp===null?expectedBefore:winPercent(secondCp*factor)/100;
    const soleMove=Boolean(bestPlayed && secondCp!==null && expectedBefore-secondExpected>=0.10);
    const sacrifice=bestPlayed && sacrificeEvidence(game,index,after);
    const legalCount=new Chess(game.fens[index]).moves().length;
    let grade:Grade;
    if(bestPlayed) grade="best";
    else if(loss<0.02) grade="excellent";
    else if(loss<0.05) grade="good";
    else if(loss<0.10) grade="inaccuracy";
    else if(loss<0.20) grade="mistake";
    else grade="blunder";
    if(bestPlayed && sacrifice && expectedAfter>=0.43 && expectedBefore<0.97 && legalCount>1)grade="brilliant";
    else if(soleMove && legalCount>1 && expectedBefore>=0.35 && expectedBefore<0.98)grade="great";
    else if(!bestPlayed && loss>=0.07 && expectedBefore>=0.68 && expectedAfter<=0.53 && index>0){
      const prev=analyses[index-1],prevAfter=analyses[index];
      const priorBest=lineCp(prev?.lines[0]), priorChosen=lineCp(prevAfter?.lines[0]);
      if(priorBest!==null&&priorChosen!==null){
        const priorFactor=move.color==="w"?-1:1;
        const priorLoss=winPercent(priorBest*priorFactor)-winPercent(priorChosen*priorFactor);
        if(priorLoss>=5)grade="miss";
      }
    }
    if(index<game.bookPlies && grade!=="blunder" && grade!=="mistake")grade="book";
    return {grade,loss,acpl,expectedBefore,expectedAfter,bestUci,bestSan:uciToSan(game.fens[index],bestUci),sacrifice,soleMove};
  });
}
export function summary(game:Game,annotations:Array<AnnotatedMove|null>) {
  const players=(["w","b"] as const).map(color=>{
    const own=annotations.filter((a,i)=>a && game.plies[i].color===color) as AnnotatedMove[];
    const accuracy=own.length?own.reduce((n,m)=>n+Math.exp(-2.8*m.loss)*100,0)/own.length:null;
    const acpl=own.length?own.reduce((n,m)=>n+m.acpl,0)/own.length:null;
    const counts:Partial<Record<Grade,number>>={};
    own.forEach(item=>counts[item.grade]=(counts[item.grade]||0)+1);
    return {color,accuracy,acpl,counts,reviewed:own.length};
  });
  return {white:players[0],black:players[1],total:annotations.filter(Boolean).length};
}
export function explanation(note:AnnotatedMove|null, san:string):string {
  if(!note)return "리뷰를 실행하면 이 수의 평가와 더 좋은 후보 수를 알려줘요.";
  switch(note.grade){
    case "brilliant":return san+"은(는) 대가를 감수하면서도 포지션을 유지한 좋은 희생이에요.";
    case "great":return "더 나쁜 대안들을 피해 꼭 필요한 수를 찾았어요.";
    case "best":return "엔진이 가장 선호하는 수를 정확히 선택했어요.";
    case "book":return "알려진 오프닝 진행과 일치하는 수예요.";
    case "excellent":return "최선과 거의 다르지 않은 안정적인 수예요.";
    case "good":return "포지션을 크게 해치지 않은 괜찮은 선택이에요.";
    case "inaccuracy":return "더 좋은 수가 있었고 승리 기대값이 조금 낮아졌어요.";
    case "mistake":return "더 정확한 수를 놓쳐 상대에게 기회를 줬어요.";
    case "miss":return "상대의 직전 실수를 충분히 활용할 기회를 놓쳤어요.";
    case "blunder":return "이 수로 유리한 평가를 크게 잃었어요. 엔진 추천 수를 확인해 보세요.";
  }
}
export const orderedGrades:Grade[]=["brilliant","great","best","excellent","good","book","inaccuracy","mistake","miss","blunder"];
export const gradeColor=(g:Grade)=>GRADE_META[g].color;
