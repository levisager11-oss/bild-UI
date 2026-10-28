import * as React from 'react';
/** CD 1.5.2 blue information box. Spickel is computed as 25% of the shorter side. */
export interface InfoBoxProps { title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; }
export function InfoBox(props: InfoBoxProps): JSX.Element;