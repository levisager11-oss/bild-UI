import * as React from 'react';
export function TextField({label,placeholder,hint,error,type='text',required,value,onChange}){const [f,setF]=React.useState(false);const id=React.useId();
  const bd=error?'#EE716D':f?'#0082B4':'#80C1DA';
  return <div style={{display:'flex',flexDirection:'column',gap:6,fontFamily:'"DIN OT",Arial,sans-serif',color:'#000000'}}>
    <label htmlFor={id} style={{fontWeight:700,fontSize:15}}>{label}{required&&' *'}</label>
    <input id={id} type={type} placeholder={placeholder} value={value} onChange={onChange} required={required} aria-invalid={!!error} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
      style={{fontFamily:'inherit',fontWeight:300,fontSize:16,minHeight:44,padding:'10px 12px',border:'2px solid '+bd,borderRadius:0,outline:'none',color:'#000000',background:'#FFFFFF'}}/>
    {(error||hint)&&<div style={{fontSize:14,fontWeight:error?700:300}}>{error||hint}</div>}
  </div>;
}