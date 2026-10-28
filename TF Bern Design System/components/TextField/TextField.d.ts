import * as React from 'react';
/** Screen UI. Black text, blue lines; error uses CD secondary red as a line only. */
export interface TextFieldProps { label: string; placeholder?: string; hint?: string; error?: string; type?: string; required?: boolean; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; }
export function TextField(props: TextFieldProps): JSX.Element;