import * as React from 'react';
export function SectionHeader({eyebrow,title,lead}){
  return <header style={{fontFamily:'"DIN OT",Arial,sans-serif',display:'flex',flexDirection:'column',gap:12}}>
    {eyebrow&&<div style={{fontWeight:700,fontSize:16,color:'#0082B4'}}>{eyebrow}</div>}
    <h2 style={{margin:0,fontWeight:700,fontSize:40,lineHeight:1.1,color:'#000000',textWrap:'balance'}}>{title}</h2>
    {lead&&<p style={{margin:0,fontWeight:300,fontSize:20,lineHeight:1.3,color:'#000000',maxWidth:'60ch',textWrap:'pretty'}}>{lead}</p>}
  </header>;
}