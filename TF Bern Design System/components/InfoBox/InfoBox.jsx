import * as React from 'react';
function useSpickel(){const [c,setC]=React.useState(0);const ro=React.useRef(null);
  const ref=React.useCallback(el=>{if(ro.current){ro.current.disconnect();ro.current=null;}if(!el)return;
    const m=()=>setC(Math.round(Math.min(el.offsetWidth,el.offsetHeight)*0.25));m();
    if(typeof ResizeObserver!=='undefined'){ro.current=new ResizeObserver(m);ro.current.observe(el);}},[]);
  return [ref,c,'polygon(0 0,100% 0,100% calc(100% - '+c+'px),calc(100% - '+c+'px) 100%,0 100%)'];}
export function InfoBox({title,children,action}){const [ref,c,clip]=useSpickel();
  return <div ref={ref} style={{background:'#0082B4',color:'#FFFFFF',padding:'28px 32px',paddingBottom:Math.max(28,c),fontFamily:'"DIN OT",Arial,sans-serif',clipPath:clip,display:'flex',flexDirection:'column',gap:12}}>
    {title&&<div style={{fontWeight:700,fontSize:22,lineHeight:1.2}}>{title}</div>}
    {children&&<div style={{fontWeight:300,fontSize:16,lineHeight:1.3}}>{children}</div>}
    {action&&<div style={{marginTop:8}}>{action}</div>}
  </div>;
}