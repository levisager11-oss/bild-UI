import * as React from 'react';
export function CourseCard({category,title,description,meta=[],href='#',linkLabel='Mehr erfahren'}){const [h,setH]=React.useState(false);
  return <a href={href} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{display:'flex',flexDirection:'column',gap:10,paddingTop:16,borderTop:'2px solid #0082B4',textDecoration:'none',color:'#000000',fontFamily:'"DIN OT",Arial,sans-serif'}}>
    {category&&<div style={{fontWeight:700,fontSize:14,color:'#0082B4'}}>{category}</div>}
    <div style={{fontWeight:700,fontSize:22,lineHeight:1.2}}>{title}</div>
    {description&&<div style={{fontWeight:300,fontSize:16,lineHeight:1.3}}>{description}</div>}
    {meta.length>0&&<div style={{fontWeight:300,fontSize:14,lineHeight:1.3}}>{meta.join(' · ')}</div>}
    <div style={{marginTop:'auto',paddingTop:8,fontWeight:700,fontSize:16,color:h?'#3399C3':'#0082B4',textDecoration:'underline'}}>{linkLabel}</div>
  </a>;
}