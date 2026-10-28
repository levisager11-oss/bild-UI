/** Offer listing. No box (CD: no boxes without Spickel) — structured by a blue rule. */
export interface CourseCardProps { category?: string; title: string; description?: string; meta?: string[]; href?: string; linkLabel?: string; }
export function CourseCard(props: CourseCardProps): JSX.Element;