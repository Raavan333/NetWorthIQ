# Add project specific ProGuard / R8 rules here.

-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepattributes SourceFile,LineNumberTable

# Preserve Capacitor Core and Bridge classes
-keep public class com.getcapacitor.** { *; }
-keep public interface com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <methods>;
}

# Preserve NetWorthIQ Native Plugins and Methods
-keep public class com.networthiq.app.** { *; }
-keepclassmembers class com.networthiq.app.** {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.PermissionCallback public *;
}

# Preserve WebView JavaScript Interfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
