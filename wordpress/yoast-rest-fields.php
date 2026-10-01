<?php
/**
 * Growth Center dashboard: let the dashboard read and write Yoast SEO's meta description,
 * focus keyphrase and SEO title through the WordPress REST API.
 *
 * Only logged-in users who can edit the specific post can change these fields (the dashboard
 * connects with an Application Password). Nothing is exposed to the public.
 *
 * Install once, using either:
 *   - the "Code Snippets" plugin: Snippets > Add New > paste everything below the <?php line >
 *     "Run snippet everywhere" > Save and Activate, or
 *   - Appearance > Theme File Editor > Consultix Child > functions.php > paste at the end > Update File.
 */
add_action( 'init', function () {
	$keys = array( '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw', '_yoast_wpseo_title' );
	foreach ( array( 'post', 'page' ) as $post_type ) {
		foreach ( $keys as $key ) {
			register_post_meta(
				$post_type,
				$key,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => true,
					'auth_callback' => function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', $post_id );
					},
				)
			);
		}
	}
} );
