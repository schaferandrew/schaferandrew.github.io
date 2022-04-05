---
layout: post
categories: technology
title: Salesforce and Wordpress??
---
![Tub of Haagen Dazs Ice Cream](/assets/img/technology/2021/wordpress/haagen-dazs.jpg)
## Overview
Haagen Dazs has franchise owners around the world. They need a single source of truth for all the information that they need when learning about the opportunity. If it’s the right fit, I also build the application form within this solution.

### Key Components I Delivered
* Client Side Form with Native and Server Response Error Handling
* Custom design of the new Website
* New Components for our Wordpress Theme
* Salesforce Integration
* First use of ReCaptcha Version 3for Accessibility
* Support for Multiple Languages and Regions

### Technology Used
* PHP (Admin.php/post)
* Wordpress 
* Local By Flywheel
* Advanced Custom Fields
* Webpack
* Salesforce - _Leads API_

### Link
[Haagen Dazs Franchisee Site →](https://www.franchise.haagen-dazs.global/franchise/)

### Table of Contents
1. [Server-Side Routing with Wordpress](#server-side-routing-in-wordpress)
2. [Error Handling](#error-handling)
3. [Design](#design)
4. [ReCaptcha](#recaptcha)
5. [Outcome](#outcome)

## Server Side Routing in Wordpress

I had to handle the submit by routing through admin.post. This is done in the functions.php.

{% highlight php %}
/**
  * Adds function for handling application form procession. Uses admin-post.php.
  * NOTE: Can also require another file that would have all of the logic
  */
 function send_application_form_to_server() {
 	require get_template_directory() . '/inc/form-processor.php';
 }

 add_action( 'admin_post_nopriv_application_form', 'send_application_form_to_server' );
 add_action( 'admin_post_application_form', 'send_application_form_to_server' );
{% endhighlight %}

The above code now requires the form processor that I created. This processed the post req and handles different options like redirecting, showing errors, or handling invalid posts.

{% highlight php %}
foreach ( $_POST as $key => $value ) {
 		if ( in_array( $key, $acceptedInputs, true ) ) {
 			$formInputs[ $key ] = clean_input( $value );
 		}
}

...

$response = wp_remote_post( $url,
	array(
 			'method'      => 'POST',
 			'timeout'     => 45,
 			'redirection' => 5,
 			'httpversion' => '1.0',
 			'blocking'    => true,
 			'headers'     => array(
 				'encoding' => 'UTF-8',
 			),
 			'body'        => $formInputs,
 			'cookies'     => array(),
 		)
 	);

...

if ( is_wp_error( $response ) ) {
 		$error_message = $response->get_error_message();
 		$error_code    = $response->get_error_code();
 		echo 'Something went wrong: ' . esc_html( $error_message );
 		wp_safe_redirect( add_query_arg( 'server_error', $error_code, home_url() . '/form/' ) );
 	} else {
 		wp_safe_redirect( home_url() . '/form-success/' );
 	}
 } else {
 	echo 'POST Variable Not Available';
 }
 die();
{% endhighlight %}

This all matched the variables that salesforce required in their dashboard. Of course we needed API Keys and urls but you don’t need that here.
## Error Handling
Error Handling takes place at three different points: 
1. When you leave an input by hitting _tab_ or clicking away
2. Client Side Checking after clicking _submit_.
3. Responding to the API Errors after submission
The [Better Native Form Validation](https://oliverjam.es/blog/better-native-form-validation/) article by Oliver Jam was very helpful in getting started with native validation. From here, it’s just reacting to the states and updating the error messages within each input group.
![Error Handling Demo](/assets/img/technology/2021/wordpress/error-handling.gif)

## Design
![Examples of the same components with different styles](/assets/img/technology/2021/wordpress/design.jpg)
The custom design called for different components with special colors and styles depending on the purpose of that section. I built components with the ability to flexible and allowed them to seamlessly blend in with each other. The purpose of this was to clearly separate what we wanted the user to get out of each section. For example: The application section was blue and support was Orange.

## ReCaptcha
To create the most accessible experience possible, I implemented [ReCaptcha Version 3]([https://developers.google.com/recaptcha/docs/v3). This version doesn’t require the annoying robot tests that are often difficult for screen reader users. This is also a better experience for everyone and is a lot quicker. It creates a score based on your behavior behind the scenes. It’s a little creepy, but it’s pretty effective.
## Outcome
Leads from direct applications went up infinitely! That’s mainly because before this, it simply didn’t exist. Potential franchisees had to resort to word of mouth or hope to get called by the right person. It also was a great test case for forms within WordPress and our team grew in capabilities that we could offer other brands. Lastly, the custom design challenge was just fun and I think it looks pretty good.
