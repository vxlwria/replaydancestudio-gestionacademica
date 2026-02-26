# Replay Dance Studio — UI Scaffold

Proyecto estático de prototipo para la gestión de un estudio de baile. Incluye página de inicio y páginas base para: alumnas, asistencia, rentas, montajes, calendario, historial mensual, respaldo y exportar.

Cómo ver localmente:

1. Abrir la carpeta del proyecto en VS Code
2. Abrir `index.html` en el navegador (doble clic) o servir con un servidor local:

```bash
# con Python 3
python3 -m http.server 8000

# luego abrir http://localhost:8000
```

Estructura principal:

- `index.html` — Página de inicio con 8 botones
- `styles.css` — Estilos base y paleta de colores
- `app.js` — Interacciones mínimas y utilidades (descarga CSV)
- `pages/` — Páginas interiores scaffold

Siguientes pasos sugeridos:
- Implementar lógica de datos (localStorage o backend)
- Implementar calendarios interactivos y modales
- Conectar exportaciones con la base de datos

## Login con Supabase (correo y contraseña)

Esta versión incluye login con Supabase Auth (email/password) y bloquea el acceso a las páginas si no hay sesión.

Pasos recomendados:

1. En Supabase > Authentication > Providers, activa **Email**.
2. Crea un usuario en Supabase > Authentication > Users (puedes usar un solo usuario compartido).
3. Asegura la tabla `rds_kv` con RLS para solo usuarios autenticados:

```sql
alter table public.rds_kv enable row level security;

drop policy if exists "Authenticated access" on public.rds_kv;
create policy "Authenticated access"
on public.rds_kv
for all
to authenticated
using (true)
with check (true);
```

4. Verifica que `SUPABASE_URL` y `SUPABASE_ANON_KEY` estén correctos en `app.js`.

La pantalla de acceso está en `pages/login.html`.

## Publicar en GitHub Pages

1. Sube el proyecto a un repositorio en GitHub.
2. Ve a **Settings → Pages**.
3. En **Source**, selecciona la rama (por ejemplo `main`) y la carpeta `/root`.
4. Guarda y espera el enlace público.

La app es estática, así que GitHub Pages funciona perfecto.
