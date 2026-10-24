# Add project specific ProGuard / R8 rules here.

# Preserve JavaScript interface for WebView bridge
-keepclassmembers class com.kuraku.budgelist.MainActivity$WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Capacitor core framework classes
-keep class com.getcapacitor.** { *; }
-keep class com.kuraku.budgelist.** { *; }

# Preserve stack trace line numbers for crash analysis
-keepattributes SourceFile,LineNumberTable
