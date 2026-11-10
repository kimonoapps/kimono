# Serialization: the Watch API shapes.
-keepattributes *Annotation*, InnerClasses, Signature
-keep,includedescriptorclasses class app.kimono.watch.**$$serializer { *; }
-keepclassmembers class app.kimono.watch.** { *** Companion; }
-keepclasseswithmembers class app.kimono.watch.** { kotlinx.serialization.KSerializer serializer(...); }
# Native decoders and libass look their Java halves up by name.
-keep class androidx.media3.decoder.ffmpeg.** { *; }
-keep class io.github.peerless2012.ass.** { *; }
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-dontwarn kotlinx.coroutines.debug.**
