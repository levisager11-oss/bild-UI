/* @ds-bundle: {"format":4,"namespace":"TFBernDesignSystem_019dd9","components":[{"name":"Badge","sourcePath":"components/Badge/Badge.jsx"},{"name":"Button","sourcePath":"components/Button/Button.jsx"},{"name":"CourseCard","sourcePath":"components/CourseCard/CourseCard.jsx"},{"name":"InfoBox","sourcePath":"components/InfoBox/InfoBox.jsx"},{"name":"SectionHeader","sourcePath":"components/SectionHeader/SectionHeader.jsx"},{"name":"SpickelImage","sourcePath":"components/SpickelImage/SpickelImage.jsx"},{"name":"TextField","sourcePath":"components/TextField/TextField.jsx"}],"sourceHashes":{"components/Badge/Badge.jsx":"1dc9d18ec181","components/Button/Button.jsx":"5e8a2f1d1b7f","components/CourseCard/CourseCard.jsx":"489f11b06184","components/InfoBox/InfoBox.jsx":"8e5cfe6cf2c8","components/SectionHeader/SectionHeader.jsx":"0cb026a053d1","components/SpickelImage/SpickelImage.jsx":"d03dd87bf8a2","components/TextField/TextField.jsx":"9a078cb47d3f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.TFBernDesignSystem_019dd9 = window.TFBernDesignSystem_019dd9 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/Badge/Badge.jsx
try { (() => {
const T = {
  blue: ['#0082B4', '#FFFFFF'],
  tint: ['#80C1DA', '#000000'],
  black: ['#000000', '#FFFFFF']
};
function Badge({
  tone = 'blue',
  children
}) {
  const t = T[tone] || T.blue;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      fontFamily: '"DIN OT",Arial,sans-serif',
      fontWeight: 700,
      fontSize: 13,
      lineHeight: 1,
      padding: '5px 8px',
      borderRadius: 0,
      background: t[0],
      color: t[1]
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Badge/Badge.jsx", error: String((e && e.message) || e) }); }

// components/Button/Button.jsx
try { (() => {
const V = {
  primary: ['#0082B4', '#3399C3', '#FFFFFF', '#0082B4', '#3399C3'],
  secondary: ['#FFFFFF', '#FFFFFF', '#0082B4', '#0082B4', '#3399C3'],
  black: ['#000000', '#0082B4', '#FFFFFF', '#000000', '#0082B4'],
  inverse: ['#FFFFFF', '#FFFFFF', '#0082B4', '#FFFFFF', '#FFFFFF']
};
const S = {
  sm: ['8px 16px', 14, 36],
  md: ['12px 24px', 16, 44],
  lg: ['16px 32px', 18, 52]
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  children,
  type = 'button'
}) {
  const [h, setH] = React.useState(false);
  const v = V[variant] || V.primary;
  const s = S[size] || S.md;
  const on = h && !disabled;
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: s[2],
      padding: s[0],
      fontFamily: '"DIN OT",Arial,sans-serif',
      fontWeight: 700,
      fontSize: s[1],
      lineHeight: 1,
      color: disabled ? '#FFFFFF' : variant === 'secondary' && on ? '#3399C3' : variant === 'inverse' && on ? '#3399C3' : v[2],
      background: disabled ? '#80C1DA' : on ? v[1] : v[0],
      border: '2px solid ' + (disabled ? '#80C1DA' : on ? v[4] : v[3]),
      borderRadius: 0,
      cursor: disabled ? 'not-allowed' : 'pointer'
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/CourseCard/CourseCard.jsx
try { (() => {
function CourseCard({
  category,
  title,
  description,
  meta = [],
  href = '#',
  linkLabel = 'Mehr erfahren'
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", {
    href: href,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      paddingTop: 16,
      borderTop: '2px solid #0082B4',
      textDecoration: 'none',
      color: '#000000',
      fontFamily: '"DIN OT",Arial,sans-serif'
    }
  }, category && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      color: '#0082B4'
    }
  }, category), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 22,
      lineHeight: 1.2
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 300,
      fontSize: 16,
      lineHeight: 1.3
    }
  }, description), meta.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 300,
      fontSize: 14,
      lineHeight: 1.3
    }
  }, meta.join(' · ')), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      paddingTop: 8,
      fontWeight: 700,
      fontSize: 16,
      color: h ? '#3399C3' : '#0082B4',
      textDecoration: 'underline'
    }
  }, linkLabel));
}
Object.assign(__ds_scope, { CourseCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/CourseCard/CourseCard.jsx", error: String((e && e.message) || e) }); }

// components/InfoBox/InfoBox.jsx
try { (() => {
function useSpickel() {
  const [c, setC] = React.useState(0);
  const ro = React.useRef(null);
  const ref = React.useCallback(el => {
    if (ro.current) {
      ro.current.disconnect();
      ro.current = null;
    }
    if (!el) return;
    const m = () => setC(Math.round(Math.min(el.offsetWidth, el.offsetHeight) * 0.25));
    m();
    if (typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver(m);
      ro.current.observe(el);
    }
  }, []);
  return [ref, c, 'polygon(0 0,100% 0,100% calc(100% - ' + c + 'px),calc(100% - ' + c + 'px) 100%,0 100%)'];
}
function InfoBox({
  title,
  children,
  action
}) {
  const [ref, c, clip] = useSpickel();
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      background: '#0082B4',
      color: '#FFFFFF',
      padding: '28px 32px',
      paddingBottom: Math.max(28, c),
      fontFamily: '"DIN OT",Arial,sans-serif',
      clipPath: clip,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 22,
      lineHeight: 1.2
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 300,
      fontSize: 16,
      lineHeight: 1.3
    }
  }, children), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, action));
}
Object.assign(__ds_scope, { InfoBox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/InfoBox/InfoBox.jsx", error: String((e && e.message) || e) }); }

// components/SectionHeader/SectionHeader.jsx
try { (() => {
function SectionHeader({
  eyebrow,
  title,
  lead
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      fontFamily: '"DIN OT",Arial,sans-serif',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 16,
      color: '#0082B4'
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontWeight: 700,
      fontSize: 40,
      lineHeight: 1.1,
      color: '#000000',
      textWrap: 'balance'
    }
  }, title), lead && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 300,
      fontSize: 20,
      lineHeight: 1.3,
      color: '#000000',
      maxWidth: '60ch',
      textWrap: 'pretty'
    }
  }, lead));
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/SectionHeader/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/SpickelImage/SpickelImage.jsx
try { (() => {
function useSpickel() {
  const [c, setC] = React.useState(0);
  const ro = React.useRef(null);
  const ref = React.useCallback(el => {
    if (ro.current) {
      ro.current.disconnect();
      ro.current = null;
    }
    if (!el) return;
    const m = () => setC(Math.round(Math.min(el.offsetWidth, el.offsetHeight) * 0.25));
    m();
    if (typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver(m);
      ro.current.observe(el);
    }
  }, []);
  return [ref, c, 'polygon(0 0,100% 0,100% calc(100% - ' + c + 'px),calc(100% - ' + c + 'px) 100%,0 100%)'];
}
function SpickelImage({
  src,
  alt = '',
  height = 360,
  placeholder = 'Bild'
}) {
  const [ref,, clip] = useSpickel();
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      width: '100%',
      height,
      clipPath: clip,
      background: '#A5ACAE',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: '"DIN OT",Arial,sans-serif',
      fontWeight: 700,
      fontSize: 14,
      color: '#000000'
    }
  }, placeholder));
}
Object.assign(__ds_scope, { SpickelImage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/SpickelImage/SpickelImage.jsx", error: String((e && e.message) || e) }); }

// components/TextField/TextField.jsx
try { (() => {
function TextField({
  label,
  placeholder,
  hint,
  error,
  type = 'text',
  required,
  value,
  onChange
}) {
  const [f, setF] = React.useState(false);
  const id = React.useId();
  const bd = error ? '#EE716D' : f ? '#0082B4' : '#80C1DA';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: '"DIN OT",Arial,sans-serif',
      color: '#000000'
    }
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontWeight: 700,
      fontSize: 15
    }
  }, label, required && ' *'), /*#__PURE__*/React.createElement("input", {
    id: id,
    type: type,
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    required: required,
    "aria-invalid": !!error,
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    style: {
      fontFamily: 'inherit',
      fontWeight: 300,
      fontSize: 16,
      minHeight: 44,
      padding: '10px 12px',
      border: '2px solid ' + bd,
      borderRadius: 0,
      outline: 'none',
      color: '#000000',
      background: '#FFFFFF'
    }
  }), (error || hint) && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: error ? 700 : 300
    }
  }, error || hint));
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/TextField/TextField.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.CourseCard = __ds_scope.CourseCard;

__ds_ns.InfoBox = __ds_scope.InfoBox;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.SpickelImage = __ds_scope.SpickelImage;

__ds_ns.TextField = __ds_scope.TextField;

})();
