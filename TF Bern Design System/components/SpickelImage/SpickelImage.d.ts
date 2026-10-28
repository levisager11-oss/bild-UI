/** CD 1.5.2 image spanning all columns, with the 45° cut bottom-right at 25% of the shorter side. Partial-width images must NOT use this. */
export interface SpickelImageProps { src?: string; alt?: string; height?: number; placeholder?: string; }
export function SpickelImage(props: SpickelImageProps): JSX.Element;