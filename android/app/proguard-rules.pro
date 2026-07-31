# Project specific ProGuard rules for R8 Optimization

# Keep Capacitor Core & Native Bridge
-keep class com.getcapacitor.** { *; }
-keep class com.elnasrcsit.cbs.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep JavaScript Interface methods annotated with @JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve WebView classes
-keep class android.webkit.** { *; }

# Keep Firebase & Notification Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Suppress R8 missing class warnings for optional Firebase KTX and Capacitor dependencies
-dontwarn com.google.firebase.**
-dontwarn com.google.firebase.ktx.**
-dontwarn com.google.android.gms.**
-dontwarn org.apache.cordova.**
-dontwarn com.capacitorjs.plugins.**
-dontwarn com.capgo.**
-dontwarn org.jetbrains.kotlin.**

# Keep Cordova plugin wrappers
-keep class org.apache.cordova.** { *; }
