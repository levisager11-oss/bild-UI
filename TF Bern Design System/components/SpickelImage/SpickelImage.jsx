import * as React from 'react';
function useSpickel(){const [c,setC]=React.useState(0);const ro=React.useRef(null);
  const ref=React.useCallback(el=>{if(ro.current){ro.current.disconnect();ro.current=null;}if(!el)return;
    const m=()=>setC(Math.round(Math.min(el.offsetWidth,el.offsetHeight)*0.25));m();
    if(typeof ResizeObserver!=='undefined'){ro.current=new ResizeObserver(m);ro.current.observe(el);}},[]);
  return [ref,c,'polygon(0 0,100% 0,100% calc(100% - '+c+'px),calc(100% - '+c+'px) 100%,0 100%)'];}
export function SpickelImage({src,alt='',height=360,placeholder='Bild'}){const [ref,,clip]=useSpickel();
  return <div ref={ref} style={{width:'100%',height,clipPath:clip,background:'#A5ACAE',display:'flex',alignItems:'center',justifyContent:'center'}}>
    {src?<img src={src} alt={alt} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>:<span style={{fontFamily:'"DIN OT",Arial,sans-serif',fontWeight:700,fontSize:14,color:'#000000'}}>{placeholder}</span>}
  </div>;
}