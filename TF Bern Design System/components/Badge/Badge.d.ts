import * as React from 'react';
/** Screen UI label. Blue, blue 50% or black only. */
export interface BadgeProps { tone?: 'blue'|'tint'|'black'; children?: React.ReactNode; }
export function Badge(props: BadgeProps): JSX.Element;