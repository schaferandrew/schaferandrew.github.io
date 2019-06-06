---
layout: post
categories: technology
title: How I built my website with Jekyll (For Free)
---

![Wordpress verus Jekyll logs](/assets/img/technology/2019/2019-05-28-how-i-built-my-website.jpg)

The hardest part of writing this website, believe it or not, was to get started. There are so many options for hosting, content management, and languages. It absolutely can be overwhelming. In the journey of building this, I started with Jekyll two years ago. It went terribly. I got caught up in trying to find the best theme and spent to much effort fighting themes instead of understanding the platform.

My career progressed into a role where I was working with a Sitecore implementation. In my undergrand, we didn't touch on CMS (content management systems) and it felt unnecessary. Why not just build a backend and link to your own database? Why be stuck to certain rules and pay someone a lot of money for that pleasure? Eventually it became clear that it was all about scale. There isn't a reason to have a developer code every page that is a little big custom. Having a separate authoring team does have extremely valuable cost savings. In my discovery period in getting familiar with the platform, I build out a proof of concept in Wordpress. Honestly it was fun. I saw how customizable it could be. The benefits of allowing guests to contribute, the thorough documentation,and it was a good skill to add to my quiver. However, it had one major downside: A cost to host.

I don't see this website as a vehicle for earning substantial income and it didn't seem to make sense to pay a monthly fee for a portfolio site when there were other options to host it for free. Looking on the site now, maybe there is opportunity for a wider audience to my content, by that certainly wasn't the driving force for this project. What wordpress did really well was help me understand the concepts of a CMS, or in Jekyll's case, a static site generator. Now that I understood the underlying development pattern, I went back to the documentation.

First of all, the documentation on the site is incredibly well maintained and easy to follow. I recommend starting here with their [step by step guide.](https://jekyllrb.com/docs/step-by-step/01-setup/).

It guides you everywhere from setting up ruby and jekyll on your machine to building a base project. Another good resource I found was [Mike Dane](https://www.youtube.com/watch?v=T1itpPvFWHI). His tuturials really helped with my grasp of the basics and using Liquid. Liquid is the programming language you can use within your markup to pull in data from the site. From there I was able to write custom code that could pull select categories. This allowed me to solve the issue wanting more than one type of posts for images, videos, etc. Below is an example of how to do that.

Place your category or categories in the front matter: 

{% highlight markdown %}
layout: post
categories: technology
title: How I built my website with Jekyll (For Free)
{% endhighlight %}

I then created a collection layout that would pull in the correct category from the page (using front matter) and compare it with the post category from above:

{% highlight html %}
{% raw %}
{% if site.posts.size > 0 %}
<ul>
    {% for post in site.posts%}
    {% if post.categories contains page.categories%}
    <li class="post-item">
        {%- assign date_format = site.minima.date_format | default: "%b %-d, %Y" -%}
        <span class="post-meta">{{ post.date | date: date_format }}</span>
        <h3>
            <a class="post-link" href="{{ post.url | relative_url }}">
                {{ post.title | escape }}
            </a>
        </h3>
        {%- if site.show_excerpts -%}
            <p>{{ post.excerpt | strip_html | truncatewords:50 }}</p>
        {%- endif -%}
    </li>
    {%endif%}
    {%endfor%}
</ul>
{% endif %}
{% endraw %}
{% endhighlight %}

The best part about this besides being able to fit my needs, is the integration with github pages. I can host the site absolutely free and can easily push up changes and add posts. If you have any questions, please reach out or check out the repository here: [Andrew Schafer's website repo](https://github.com/schaferandrew/schaferandrew.github.io).