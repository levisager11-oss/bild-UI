import * as React from 'react';
const V={primary:['#0082B4','#3399C3','#FFFFFF','#0082B4','#3399C3'],secondary:['#FFFFFF','#FFFFFF','#0082B4','#0082B4','#3399C3'],black:['#000000','#0082B4','#FFFFFF','#000000','#0082B4'],inverse:['#FFFFFF','#FFFFFF','#0082B4','#FFFFFF','#FFFFFF']};
const S={sm:['8px 16px',14,36],md:['12px 24px',16,44],lg:['16px 32px',18,52]};
export function Button({variant='primary',size='md',disabled=false,onClick,children,type='button'}){
  const [h,setH]=React.useState(false);const v=V[variant]||V.primary;const s=S[size]||S.md;const on=h&&!disabled;
  return <button type={type} disabled={disabled} onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
    style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,minHeight:s[2],padding:s[0],fontFamily:'"DIN OT",Arial,sans-serif',fontWeight:700,fontSize:s[1],lineHeight:1,
      color:disabled?'#FFFFFF':(variant==='secondary'&&on?'#3399C3':variant==='inverse'&&on?'#3399C3':v[2]),background:disabled?'#80C1DA':(on?v[1]:v[0]),border:'2px solid '+(disabled?'#80C1DA':on?v[4]:v[3]),borderRadius:0,cursor:disabled?'not-allowed':'pointer'}}>{children}</button>;
}