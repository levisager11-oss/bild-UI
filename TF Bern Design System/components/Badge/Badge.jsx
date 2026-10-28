import * as React from 'react';
const T={blue:['#0082B4','#FFFFFF'],tint:['#80C1DA','#000000'],black:['#000000','#FFFFFF']};
export function Badge({tone='blue',children}){const t=T[tone]||T.blue;
  return <span style={{display:'inline-flex',alignItems:'center',fontFamily:'"DIN OT",Arial,sans-serif',fontWeight:700,fontSize:13,lineHeight:1,padding:'5px 8px',borderRadius:0,background:t[0],color:t[1]}}>{children}</span>;
}