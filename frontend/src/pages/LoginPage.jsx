// Página del ingreso único, que sirve para la Bitácora, el inventario y la administración.
import Login from '../components/Login';

// Muestra el formulario de ingreso.
export default function LoginPage({ onLogin, error, verificando }) {
  return <Login onLogin={onLogin} error={error} verificando={verificando} />;
}
