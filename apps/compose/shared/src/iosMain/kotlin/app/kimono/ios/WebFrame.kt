@file:OptIn(ExperimentalForeignApi::class)

package app.kimono.ios

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import app.kimono.data.WebFrameControl
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readValue
import platform.CoreGraphics.CGRectZero
import platform.Foundation.NSURL
import platform.Foundation.NSURLRequest
import platform.UIKit.UIColor
import platform.WebKit.WKNavigation
import platform.WebKit.WKNavigationAction
import platform.WebKit.WKNavigationActionPolicy
import platform.WebKit.WKNavigationDelegateProtocol
import platform.WebKit.WKScriptMessage
import platform.WebKit.WKScriptMessageHandlerProtocol
import platform.WebKit.WKUserContentController
import platform.WebKit.WKWebView
import platform.WebKit.WKWebViewConfiguration
import platform.WebKit.WKWebsiteDataStore
import platform.darwin.NSObject

/** What the page posts to webkit.messageHandlers.kimono. */
private class Heard(val each: (String) -> Unit) : NSObject(), WKScriptMessageHandlerProtocol {
    override fun userContentController(userContentController: WKUserContentController, didReceiveScriptMessage: WKScriptMessage) {
        (didReceiveScriptMessage.body as? String)?.let(each)
    }
}

/** Loads, and links: they leave for Safari unless the page keeps them. */
private class Steering(val home: String, val host: String?, val keepLinks: Boolean, val open: (String) -> Unit, val loaded: () -> Unit) : NSObject(), WKNavigationDelegateProtocol {
    override fun webView(webView: WKWebView, didFinishNavigation: WKNavigation?) { loaded() }
    override fun webView(webView: WKWebView, decidePolicyForNavigationAction: WKNavigationAction, decisionHandler: (WKNavigationActionPolicy) -> Unit) {
        val to = decidePolicyForNavigationAction.request.URL
        /* Its own page (and what the page writes into itself) always loads; anything else is a link. */
        val own = to?.absoluteString?.substringBefore('#') == home.substringBefore('#')
        val same = to?.host == host
        if (own || (keepLinks && same) || to?.scheme == "about" || to?.scheme == "data" || to?.scheme == "blob") { decisionHandler(WKNavigationActionPolicy.WKNavigationActionPolicyAllow); return }
        to?.absoluteString?.let { if (to.scheme == "http" || to.scheme == "https" || to.scheme == "mailto") open(it) }
        decisionHandler(WKNavigationActionPolicy.WKNavigationActionPolicyCancel)
    }
}

@Composable
internal fun IosWebFrame(url: String, modifier: Modifier, control: WebFrameControl?, keepLinks: Boolean, openUrl: (String) -> Unit, onMessage: (String) -> Unit, onLoaded: () -> Unit) {
    val heard = rememberUpdatedState(onMessage)
    val loaded = rememberUpdatedState(onLoaded)
    UIKitView(
        factory = {
            val configuration = WKWebViewConfiguration().apply {
                /* An artifact keeps nothing; a running app may keep what it likes, for this launch. */
                websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore()
                allowsInlineMediaPlayback = true
                userContentController.addScriptMessageHandler(Heard { heard.value(it) }, "kimono")
            }
            val view = WKWebView(frame = CGRectZero.readValue(), configuration = configuration)
            view.opaque = false
            view.backgroundColor = UIColor.clearColor
            view.scrollView.backgroundColor = UIColor.clearColor
            if (control?.scrolls == false) { view.scrollView.scrollEnabled = false; view.scrollView.bounces = false }
            val steering = Steering(url, NSURL.URLWithString(url)?.host, keepLinks, openUrl) { loaded.value() }
            /* The view holds its delegate weakly: keep it alive with the view. */
            view.navigationDelegate = steering
            delegates[view.hashCode()] = steering
            control?.run = { script -> view.evaluateJavaScript(script, null) }
            NSURL.URLWithString(url)?.let { view.loadRequest(NSURLRequest.requestWithURL(it)) }
            view
        },
        modifier = modifier,
        onRelease = { view ->
            control?.run = null
            delegates.remove(view.hashCode())
            view.configuration.userContentController.removeScriptMessageHandlerForName("kimono")
        },
        properties = UIKitInteropProperties(isInteractive = true, isNativeAccessibilityEnabled = true),
    )
}

private val delegates = mutableMapOf<Int, NSObject>()
