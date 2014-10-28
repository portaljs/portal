$(function () {
	var $display = $('<div/>')
		.css({
			'white-space': 'nowrap',
			'user-select': 'none',
		})
		.appendTo('body');
	['log', 'client', 'server', 'other', 'portal:analytics', 'portal:analytics(static files)'].forEach(function (type) {
		var $el = $('<div><input type="checkbox"/><label/></div>').appendTo($display),
			$input = $('input', $el)
				.attr('id', 'event.errorType,' + type);
		$('label', $el)
			.css('text-transform', 'capitalize')
				.attr('for', 'event.errorType,' + type)
			.text(type);
		$input.click(function () {
			var errorType = JSON.parse(localStorage['event.errorType']||'{}');
			errorType[type] = $input.is(':checked');
			localStorage['event.errorType'] = JSON.stringify(errorType);
		});
		if (JSON.parse(localStorage['event.errorType']||'{}')[type] !== false) {
			$input.attr('checked', 'checked');
		}
	});
	{
		var $el = $('<div><label/>:<br/><input/></div>').appendTo($display),
			$input = $('input', $el)
			.attr('id', 'event.debugFilterUser')
			.on('change keyup', function () {
				localStorage['event.debugFilterUser'] = JSON.stringify($input.val());
			})
		$('label', $el)
			.css('text-transform', 'capitalize')
				.attr('for', 'event.debugFilterUser')
			.text('Username');
		$input.val(JSON.parse(localStorage['event.debugFilterUser']||'""'));
	}
});