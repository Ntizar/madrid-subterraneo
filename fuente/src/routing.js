export function findRoute(data, origin, destination, priority='changes') {
 if(origin===destination)return {nodes:[origin],edges:[],changes:0};
 const adj=new Map(data.stations.map(s=>[s.id,[]]));
 data.edges.forEach((e,index)=>{adj.get(e.a)?.push({to:e.b,e,index});adj.get(e.b)?.push({to:e.a,e,index})});
 const start=origin+'|';const dist=new Map([[start,0]]),prev=new Map(),queue=[{key:start,id:origin,line:'',cost:0}];let goal;
 while(queue.length){queue.sort((a,b)=>a.cost-b.cost);const cur=queue.shift();if(cur.cost!==dist.get(cur.key))continue;if(cur.id===destination){goal=cur.key;break;}
 for(const {to,e,index} of adj.get(cur.id)||[]){const change=!!cur.line&&cur.line!==e.line;const cost=cur.cost+(priority==='changes'?(change?1000:0)+1:1000+(change?1:0));const key=to+'|'+e.line;
 if(cost<(dist.get(key)??Infinity)){dist.set(key,cost);prev.set(key,{from:cur.key,index});queue.push({key,id:to,line:e.line,cost});}}
 }
 if(!goal)return null;const nodes=[],edges=[];let k=goal;while(k!==start){nodes.unshift(k.split('|')[0]);const p=prev.get(k);edges.unshift(p.index);k=p.from;}nodes.unshift(origin);let changes=0;for(let i=1;i<edges.length;i++)if(data.edges[edges[i-1]].line!==data.edges[edges[i]].line)changes++;return {nodes,edges,changes};
}
