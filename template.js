define([
    "jquery",
    "patterns",
    'logging',
    "pat-parser",
    "pat-inject",
    "handlebars",
    "innerxhtml"
], function($, patterns, logger, Parser, inject, _handlebars) {
    var log = logger.getLogger('pat.template'),
        parser = new Parser("template", { inherit: false });

    parser.add_argument("template");
    parser.add_argument("name");
    parser.add_argument("context");
    parser.add_argument("sort");
    parser.add_argument("condition");
    parser.add_argument("wrap");
    parser.add_argument("expand");

    var _ = {
        name: "template",
        _countId: 0,

        transform: function($content) {
            $content
                .findInclusive('.pat-template')
                .filter(function() {
                    // do not initialize nested templates individually
                    return $(this).parents('.pat-template').length === 0;
                })
                .each(function() {
                    var $el = $(this);
                    _._transform($el);
                    $el.findInclusive('.pat-template')
                        .addClass('template-rendered');
                });
        },

       _transform: function($el, opts) {
            return $el.each(function() {
                var $el = $(this),
                    context = $('body').data('pat-context') || {};

                // initialize global context
                context.href = location.href;
                location.search.substr(1).split('&').forEach(function(str) {
                    if (str) {
                        var keyValue = str.split('='),
                            key = keyValue[0],
                            value = decodeURIComponent(keyValue[1]);
                        if (value && (value.match(/^\[.*\]$/) ||
                                      value.match(/^\{.*\}$/))) {
                            context[key] = JSON.parse(value);
                        } else {
                            context[key] = value;
                        }
                    }
                });
                // save context on body in case templating error occurs
                $('body').data('pat-context', context);

                // XXX: transform receives the elements parent
                // first. It feels recursive traversal should not be
                // needed, but elements could be handled one-by-one.
                _._traverseTemplates($el, opts, context, context);
                $('body').data('pat-context', context);

                var source;
                if (document.all) {
                    // ie codepath
                    source = innerXHTML($el[0]);
                    // sadly this is necessary, IE8
                    source = source.replace(/<\/(input|img|br|hr)>/g, '');
                } else {
                    source = $el.html();
                }

                var template = Handlebars.compile(source),
                    html = template(context);

                // IE8 adds selected automatically :(
                html = html.replace(/selected ([^>]*) data-selected/g, '$1 data-selected');
                html = html.replace(/data-selected([^>]*) selected/g, 'data-selected$1');

                html = html.replace(/data-selected="true"/g, 'selected="selected"');
                html = html.replace(/data-checked="true"/g, 'checked="checked"');

                $el.html(html);

                $el.findInclusive('img').each(function() {
                    var $el = $(this);
                    $el.attr('src', $el.attr('data-src'));
                });
            });
        },

        _traverseTemplates: function($el, opts, context, global_context) {
            // process $el and its child templates separately, as the content
            // of $el is regenerated on load.
            context = _._loadTemplateAndContext($el, opts, context,
                                                global_context);
            $el.find('[data-pat-template]').each(function() {
                // XXX: find only first level descendants instead of this check
                if ($(this).parents('html').length !== 0) {
                    _._traverseTemplates($(this), opts, context,
                                         global_context);
                }
            });
        },

        _loadTemplateAndContext: function($el, opts, context, global_context) {
            var cfg = parser.parse($el, opts),
                url, id, html, $template;

            log.debug('config', cfg);

            if (cfg.template) {
                url = cfg.template.split('#')[0];
                id = cfg.template.split('#')[1];
                html = _._synchronous_ajax_get($el, url);
                $template = $(html).findInclusive('#' + id);
            } else {
                $template = $el;
            }

            if ($template.children().filter('.pat-template-include').length > 0) {
                $template.children(":not(.pat-template-include)").remove();
            }
            $template.children(".pat-template-exclude").remove();

            var name = cfg.name || $el.attr('id') || 'template' + _._countId++,
                source,
                ctx;

            if (document.all) {
                // ie codepath
                source = innerXHTML($template[0]).trim();
                // sadly this is necessary, IE8
                source = source.replace(/<\/(input|img|br|hr)>/g, '');
            } else {
                source = $template.html().trim();
            }

            if (cfg.context) {
                cfg.context = Handlebars.compile(cfg.context)(global_context);
                ctx = _._synchronous_ajax_get($el, cfg.context);
            }

            if (Array.isArray(ctx)) {
                if (cfg.sort) {
                    cfg.sort = cfg.sort.split(',');
                    ctx = ctx.sort(function(a, b) {
                        var left = cfg.sort.map(function(x) { return a[x]; }).join(', ');
                        var right = cfg.sort.map(function(x) { return b[x]; }).join(', ');
                        return left.localeCompare(right);;
                    });
                }
            }

            // if cfg.context was empty use parent variable
            if (ctx) {
                if (Array.isArray(context)) {
                    context.forEach(function(c) { c[name] = ctx; });
                } else {
                    context[name] = ctx;
                }
            } else {
                if (Array.isArray(context)) {
                    ctx = context[0][name];
                } else {
                    ctx = context[name];
                }
            }

            // make sure ctx is really there
            if (!ctx) {
                if (Array.isArray(context)) {
                    ctx = context[0][name] = {};
                } else {
                    ctx = context[name] = {};
                }
            }

            // XXX: where do we use/need this?
            if (cfg.condition) {
                source = '{{#condition ' + cfg.condition +
                         '}}' + source + '{{/condition}}';
            }

            if (['TABLE', 'TBODY', 'TR'].indexOf($el[0].tagName) >= 0 || cfg.expand === 'before') {
                var sources = [];
                if (!Array.isArray(ctx)) {
                    ctx = [ ctx ];
                }
                ctx.forEach(function(e) {
                    var src = source;
                    //if (typeof e === 'string') {
                    //    src = src.replace(/\{\{this\}\}/g, e);
                    //} else {
                    //    Object.keys(e).forEach(function(key) {
                    //        src = src.replace(new RegExp('{{'+key+'}}', 'g'), e[key]);
                    //    });
                    //}
                    e['PARENT'] = context;
                    src = Handlebars.compile(src)(e);
                    sources.push(src);
                });
                source = sources.join();
            } else {
                if (cfg.wrap) {
                    if (cfg.wrap !== 'none') {
                        source = "{{#"+cfg.wrap+" " + name + "}}" + source + "{{/"+cfg.wrap+"}}";
                    }
                } else {
                    if (Array.isArray(ctx)) {
                        source = "{{#each " + name + "}}" + source + "{{/each}}";
                    } else {
                        source = "{{#with " + name + "}}" + source + "{{/with}}";
                    }
                }
            }

            $el.html(source);

            return ctx;
        },

        _synchronous_ajax_get: function($el, url, suppress_error_event) {
            var result;
            try {
                log.debug("Performing ajax request for:", url, $el);
                $.ajax({
                    url: url,
                    async: false,
                    success: function(data, status, jqxhr) {
                        log.debug("success: jqxhr:", jqxhr);

                        // XXX: this feels like a bad idea, esp. in
                        // case we want to GET individual string
                        // attribute.
                        //
                        // from prototype it's already parsed, coming
                        // from plone it's still a string
                        if (typeof data === "string") {
                            try {
                                result = JSON.parse(data);
                            } catch (e) {
                                log.error("Error parsing json from '" +
                                          url + "': " + e);
                            }
                        } else {
                            result = data;
                        }
                    },
                    error: function(jqxhr, status, error) {
                        log.debug("error:", status, error, jqxhr);
                        if (status === "parsererror") {
                            log.error("Syntax error in json from:", url);
                        }
                        if (!suppress_error_event) {
                            $el.trigger({
                                type: "pat-template-error",
                                error: error,
                                jqxhr: jqxhr,
                                status: jqxhr.status
                            });
                        }
                    }
                });
            } catch(e) {
                log.error("Error performing ajax request from '" +
                          url + "': " + e);
            }

            return result;
        }
    };

    Handlebars.registerHelper('setSelected', function(is, should) {
        is = is || "";
        should = should || "";
        // later, false attributes will be removed and true ones set
        // to correct string
        if (Array.isArray(should)) {
            return (should.indexOf(is) >= 0) ? "true" : "false";
        } else {
            return (is === should) ? "true" : "false";
        }
    });

    Handlebars.registerHelper('setChecked', function(is, should) {
        is = is || "";
        should = should || "";
        // later, false attributes will be removed and true ones set
        // to correct string
        if (Array.isArray(should)) {
            return (should.indexOf(is) >= 0) ? "true" : "false";
        } else {
            return (is === should) ? "false" : "false";
        }
    });

    Handlebars.registerHelper('condition', function(left_op, op, right_op, options) {
        switch (op) {
            case 'equals':
                if (left_op === right_op) {
                    return options.fn(this);
                }
                break;
            case 'unequals':
                if (left_op !== right_op) {
                    return options.fn(this);
                }
                break;
            case 'contains':
                if (left_op.indexOf(right_op) >= 0) {
                    return options.fn(this);
                }
                break;
        }
    });

    Handlebars.registerHelper('filterATandDOT', function(arg) {
        return arg.replace(/[@\.]/g, '');
    });

    Handlebars.registerHelper('defaultValue', function(val, def) {
        return (val !== undefined ? val : def);
    });

    Handlebars.registerHelper('lookup', function(value, list, key, return_key) {
        return list.filter(function(x) {
            return x[key] === value;
        })[0][return_key];
    });

    patterns.register(_);
});
