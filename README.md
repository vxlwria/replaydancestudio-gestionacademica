[README.md](https://github.com/user-attachments/files/25783123/README.md)
# Replay Dance Studio — Gestión Académica

Proyecto estático para la gestión de un estudio de baile.
Incluye página de inicio y páginas completas para: alumnas, asistencia, rentas, montajes, calendario, historial mensual, respaldo y exportar.

---

## Cómo ver localmente

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
- `app.js` — Lógica completa (datos, sync, UI)  
- `pages/` — Páginas interiores  
- `docs/sql/001_studio_schema.sql` — Migraciones SQL para Supabase  

---

## Configuración de Supabase (multi-usuario / multi-dispositivo)

La app usa Supabase para autenticación y sincronización en la nube.
Los datos se aíslan por **estudio** (tenant), lo que permite que varios usuarios compartan la misma información en tiempo real.

### Requisitos previos

- Una cuenta y proyecto en [Supabase](https://supabase.com)
- La extensión `pgcrypto` activa (viene activada por defecto en todos los proyectos Supabase)
- Realtime habilitado para la tabla `rds_kv` (ver paso 4)

### Paso 1 — Ejecutar el schema SQL

En el **SQL Editor** de tu proyecto Supabase, ejecuta el archivo completo:

```
docs/sql/001_studio_schema.sql
```

Este script crea:
- `studios` — tabla de estudios (tenants)
- `studio_members` — usuarios del estudio con roles (`admin`, `staff`, `viewer`)
- `rds_kv` — almacén de datos clave-valor con aislamiento por estudio, `updated_at`, `updated_by`, y políticas RLS

También habilita Realtime para `rds_kv` y configura un trigger para actualizar `updated_at` automáticamente.

### Paso 2 — Activar el proveedor Email en Auth

En **Supabase > Authentication > Providers**, activa **Email**.

### Paso 3 — Crear el primer usuario (administrador)

En **Supabase > Authentication > Users**, crea el usuario con correo y contraseña.

Luego, en el SQL Editor, ejecuta el siguiente bloque reemplazando los valores:

```sql
DO $$
DECLARE
  v_studio_id uuid;
  v_user_id   uuid;
BEGIN
  -- Crear el estudio
  INSERT INTO public.studios (name) VALUES ('Replay Dance Studio')
  RETURNING id INTO v_studio_id;

  -- Buscar el usuario por correo
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@tudominio.com';

  -- Asignarlo como administrador
  INSERT INTO public.studio_members (studio_id, user_id, role)
  VALUES (v_studio_id, v_user_id, 'admin');

  RAISE NOTICE 'Studio ID: %', v_studio_id;
END $$;
```

### Paso 4 — Habilitar Realtime para `rds_kv`

El script SQL ya ejecuta `ALTER PUBLICATION supabase_realtime ADD TABLE public.rds_kv;`, pero también puedes verificarlo en:

**Supabase > Database > Replication** → asegúrate de que `rds_kv` aparezca en la lista de tablas publicadas.

### Paso 5 — Agregar usuarios tipo staff

Para agregar más usuarios al estudio:

1. Crea el usuario en **Supabase > Authentication > Users**
2. Ejecuta en el SQL Editor (reemplaza los UUIDs):

```sql
INSERT INTO public.studio_members (studio_id, user_id, role)
VALUES (
  '<uuid-del-estudio>',   -- de la tabla studios
  '<uuid-del-usuario>',   -- de auth.users
  'staff'                 -- o 'admin' o 'viewer'
);
```

O busca el UUID del usuario por correo:

```sql
INSERT INTO public.studio_members (studio_id, user_id, role)
SELECT
  '<uuid-del-estudio>',
  id,
  'staff'
FROM auth.users
WHERE email = 'staff@tudominio.com';
```

### Paso 6 — Configurar las credenciales en `app.js`

Verifica que las siguientes constantes al inicio de `app.js` sean correctas:

```js
const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'tu_anon_key_publica';
```

> **Nota:** La `anon key` es pública y puede quedar en el código fuente.
> Si prefieres usar variables de entorno (por ejemplo con un bundler), reemplaza
> los valores con `import.meta.env.VITE_SUPABASE_URL` o similar.

---

## Cómo funciona la sincronización

- **Escritura local:** cada cambio en `localStorage` (claves `rds_*`) se encola y sube a Supabase cada ~4 segundos.
- **Lectura periódica:** cada 15 segundos se bajan cambios remotos del estudio actual.
- **Realtime WebSocket:** las actualizaciones de otros dispositivos llegan instantáneamente a través de Supabase Realtime (WebSocket/Phoenix channels). El polling de 15 s actúa como respaldo si la conexión WebSocket cae.
- **Evento `rds_remote_sync`:** cuando llegan datos remotos se dispara este evento con las claves modificadas. Cada página escucha el evento y vuelve a renderizar solo lo necesario.
- **Aislamiento por estudio:** todas las operaciones REST y Realtime filtran por `studio_id`, garantizado también a nivel de base de datos mediante RLS.
- **Claves excluidas del sync:** `rds_auth_session_v1` (tokens de sesión) y `rds_studio_id_cache` (caché local) nunca se sincronizan a la nube.
- **Último escritor gana:** cada fila de `rds_kv` incluye `updated_at` actualizado automáticamente. En el frontend, una escritura local pendiente en la cola siempre tiene prioridad sobre una actualización remota de la misma clave.

---

## Publicar en GitHub Pages

1. Sube el proyecto a un repositorio en GitHub.
2. Ve a **Settings → Pages**.
3. En **Source**, selecciona la rama (por ejemplo `main`) y la carpeta `/root`.
4. Guarda y espera el enlace público.

La app es completamente estática; GitHub Pages funciona perfectamente.

