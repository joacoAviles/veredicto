# Google Calendar

Veredicto usa **tu propio cliente OAuth** de Google Cloud: el permiso queda entre tu cuenta de Google y tu servidor. Lo haces una sola vez, en unos 10 minutos. Necesitas que Veredicto tenga dirección `https` ([docs/tunel.md](tunel.md)).

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) y crea un proyecto llamado «Veredicto».
2. **APIs y servicios → Biblioteca** → busca **Google Calendar API** → **Habilitar**.
3. **Pantalla de consentimiento de OAuth** (Google Auth Platform):
   - Tipo de usuario: **Externo**. Nombre de la app: «Veredicto». Correo de asistencia: el tuyo.
   - Agrega tu correo como usuario de prueba.
   - En **Público**, toca **Publicar app** para pasarla a **En producción**. Si la dejas en «Prueba», Google corta el acceso cada 7 días.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **URI de redireccionamiento autorizados**: `https://TU-DOMINIO/oauth/google` (Veredicto te muestra la dirección exacta en el asistente).
   - Copia el **ID de cliente** y el **Secreto del cliente**.
5. En Veredicto: **Ajustes → paso 2 → + Google**, pega los dos y toca **Dar permiso en Google**.
6. Google dirá que la app **no está verificada**: es tu propia app. Toca **Configuración avanzada → Ir a Veredicto** y acepta el acceso al calendario.
7. Vuelves a Veredicto con tus calendarios listados. Crea «Veredicto · Plan» o elige uno existente.

Si un día ves «Se perdió el permiso», vuelve a conectar desde el mismo paso.
