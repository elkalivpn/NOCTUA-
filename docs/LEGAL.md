# Aviso Legal y Disclaimer

## Uso Autorizado

**NOCTUA** es una herramienta diseñada **exclusivamente** para:

- Investigación de seguridad autorizada
- Pruebas de penetración en entornos controlados
- Análisis defensivo de sistemas propios
- Participación en competiciones de seguridad (CTF)
- Educación en ciberseguridad

## Responsabilidad del Usuario

**El usuario es el único responsable** de garantizar que posee los permisos legales necesarios para:

1. Acceder a los sistemas que analiza
2. Ejecutar las herramientas integradas en NOCTUA
3. Realizar cualquier acción de depuración o análisis
4. Distribuir o compartir los resultados del análisis

## Advertencias Específicas

### Sobre Ejecución de Código

- NOCTUA **no crea una sandbox** para la ejecución de binarios
- Los programas que depure se ejecutan con **sus privilegios de usuario**
- La terminal integrada tiene acceso completo a su sistema de archivos
- **No ejecute código no confiable** directamente en NOCTUA

### Sobre Análisis de Malware

- NOCTUA **no está diseñado** para análisis seguro de malware
- El análisis estático es seguro (solo lectura)
- El análisis dinámico **no es seguro** en la versión actual
- **No use NOCTUA** para analizar muestras de malware sin un entorno aislado adecuado

### Sobre el Depurador

- El depurador ejecuta el binario (inferior) con sus privilegios
- No hay protección contra código malicioso
- La fase 2 del diseño (v0.4) incluirá soporte para gdbserver en VM
- Hasta entonces, **use el depurador solo con binarios de confianza**

## Limitación de Responsabilidad

Los autores, contribuidores y mantenedores de NOCTUA **no se hacen responsables** de:

1. Daños a sistemas o datos causados por el uso de NOCTUA
2. Violaciones legales cometidas usando NOCTUA
3. Pérdida de datos durante el análisis
4. Comportamiento inesperado de herramientas externas invocadas por NOCTUA
5. Vulnerabilidades de seguridad en el propio NOCTUA
6. Uso indebido por terceros

## Jurisdicción

El uso de NOCTUA está sujeto a las leyes de su jurisdicción local. Los autores no proporcionan asesoramiento legal. Si tiene dudas sobre la legalidad de sus acciones, consulte con un profesional legal antes de usar NOCTUA.

## Contexto "Grey Hat"

NOCTUA se desarrolla bajo una filosofía **grey hat**:

- **White Hat:** Solo se usa con permiso explícito
- **Grey Hat:** Se usa para descubrir vulnerabilidades y reportarlas
- **Black Hat:** Uso malicioso (prohibido)

**NOCTUA apoya el enfoque grey hat:** descubrir vulnerabilidades para reportarlas de manera responsable, pero **siempre** con permiso o en sistemas propios.

## Reportando Vulnerabilidades en NOCTUA

Si descubre una vulnerabilidad en NOCTUA mismo:

1. **No la divulgue públicamente** sin notificación previa
2. Abra un issue privado o contacte a los mantenedores
3. Proporcione detalles técnicos para su reparación
4. Se le acreditará adecuadamente

## Licencia

NOCTUA se distribuye bajo la licencia **MIT**. Consulte [LICENSE](../LICENSE) para los términos completos.

## Declaración de Conformidad

NOCTUA:
- ✅ No incluye código malicioso
- ✅ No realiza acciones ocultas
- ✅ No envía datos a servidores externos (excepto el proveedor de IA si está configurado)
- ✅ Es software de código abierto
- ✅ Puede ser auditado completamente

## Recomendaciones de Seguridad

### Para Usuarios

1. **Ejecute NOCTUA en una máquina virtual** para análisis de código no confiable
2. **Use una cuenta de usuario dedicada** sin privilegios elevados
3. **Revise los plugins** antes de instalarlos
4. **Configure el agente IA local** (Ollama) para evitar enviar datos a la nube
5. **Mantenga su sistema actualizado**

### Para Desarrolladores

1. **No añada código que ejecute shell arbitrario**
2. **Valide todas las entradas de usuario**
3. **Use el sistema de permisos de plugins**
4. **Documente las implicaciones de seguridad** de cada cambio
5. **Revise el código de otros contribuidores**

## Contacto

Para preguntas sobre el uso adecuado de NOCTUA:
- Abra un issue en GitHub
- Consulte la documentación
- Revise los ejemplos en el repositorio

**No usamos NOCTUA para:**
- Ataques a sistemas sin autorización
- Violación de leyes locales o internacionales
- Actividades maliciosas de cualquier tipo

---

**Última actualización:** Octubre 2026  
**Versión:** v0.3.6  
**Mantenedor:** elkalivpn
