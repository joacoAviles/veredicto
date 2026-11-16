# Outlook / Microsoft 365

Veredicto usa **tu propio registro de app** en Microsoft Entra (Azure), gratis. Necesitas que Veredicto tenga dirección `https` ([docs/tunel.md](tunel.md)).

1. Entra a [entra.microsoft.com](https://entra.microsoft.com) (o portal.azure.com) → **Registros de aplicaciones → Nuevo registro**.
2. Nombre: «Veredicto». Tipos de cuenta: **Cuentas en cualquier directorio organizativo y cuentas Microsoft personales**.
3. **URI de redirección**: plataforma **Web**, dirección `https://TU-DOMINIO/oauth/outlook`. **Registrar**.
4. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos delegados**: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
5. **Certificados y secretos → Nuevo secreto de cliente** (24 meses). Copia el **Valor** (no el «Id. de secreto»).
6. En **Información general**, copia el **Id. de aplicación (cliente)**.
7. En Veredicto: **Ajustes → paso 2 → + Outlook**, pega los dos y toca **Dar permiso en Microsoft**.

El secreto vence: anota la fecha y, antes de que llegue, crea uno nuevo y vuelve a conectar.
