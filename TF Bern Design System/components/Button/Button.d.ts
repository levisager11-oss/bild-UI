import * as React from 'react';
/** Screen UI (not specified in the CD manual). CD colours only, rectangular. */
export interface ButtonProps { variant?: 'primary'|'secondary'|'black'|'inverse'; size?: 'sm'|'md'|'lg'; disabled?: boolean; onClick?: (e: React.MouseEvent) => void; children?: React.ReactNode; type?: 'button'|'submit'; }
export function Button(props: ButtonProps): JSX.Element;