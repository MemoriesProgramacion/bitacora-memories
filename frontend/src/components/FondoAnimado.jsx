// Fondo en movimiento detrás de toda la aplicación: manchas de color que derivan despacio sobre una cuadrícula
// tenue. Es decorativo, no recibe clics y solo anima transform. Los estilos están en index.css.
function Capa({ clase = '', children }) {
  return (
    <div className={`fondo-animado ${clase}`} aria-hidden="true">
      <span className="fondo-orbe o1" />
      <span className="fondo-orbe o2" />
      <span className="fondo-orbe o3" />
      {children}
    </div>
  );
}

// Fondo claro de la aplicación con sesión iniciada.
export default function FondoAnimado() {
  return <Capa />;
}

// Fondo oscuro de la pantalla de ingreso, con figuras que flotan.
export function FondoIngreso() {
  return (
    <Capa clase="oscuro">
      <span className="figura-flota" style={{ left: '8%', top: '18%', width: 90, height: 90, '--giro': '12deg' }} />
      <span className="figura-flota" style={{ right: '12%', top: '14%', width: 56, height: 56, '--giro': '-18deg', animationDelay: '-3s' }} />
      <span className="figura-flota" style={{ left: '16%', bottom: '14%', width: 64, height: 64, '--giro': '30deg', animationDelay: '-5s' }} />
      <span className="figura-flota" style={{ right: '9%', bottom: '20%', width: 110, height: 110, '--giro': '-8deg', animationDelay: '-7s' }} />
    </Capa>
  );
}
