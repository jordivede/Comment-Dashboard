// Main plugin code - runs in Figma's plugin sandbox
// This code has access to the figma global object

// Show the UI
figma.showUI(__html__, {
  width: 400,
  height: 600,
  themeColors: true
});

// OAuth Token Configuration
let OAUTH_TOKEN = null;

// Store normalized comments for filtering
let allComments = [];
let currentFilters = {
  status: null,
  author: null,
  page: null,
  node_type: null,
  age_range: null,
  search: null
};

// Handle messages from the UI
figma.ui.onmessage = function(msg) {
  switch (msg.type) {
    case 'fetch-comments':
      fetchComments();
      break;
    
    case 'set-token':
      handleSetToken(msg);
      break;
    
    case 'apply-filters':
      handleApplyFilters(msg);
      break;
    
    case 'navigate-to-comment':
      handleNavigateToComment(msg);
      break;
    
    case 'resize':
      handleResize(msg);
      break;
    
    case 'close-plugin':
      figma.closePlugin();
      break;
    
    default:
      console.warn('Unknown message type:', msg.type);
      sendError('Unknown message type: ' + msg.type);
  }
};

/**
 * Handles setting OAuth token
 */
function handleSetToken(msg) {
  if (!msg.token || typeof msg.token !== 'string') {
    sendError('Invalid token format');
    return;
  }
  
  OAUTH_TOKEN = msg.token;
  sendMessage({
    type: 'token-set',
    message: 'Token set successfully'
  });
}

/**
 * Handles filter updates from UI
 */
function handleApplyFilters(msg) {
  if (!msg.filters || typeof msg.filters !== 'object') {
    sendError('Invalid filters format');
    return;
  }
  
  currentFilters = {
    status: msg.filters.status || null,
    author: msg.filters.author || null,
    page: msg.filters.page || null,
    node_type: msg.filters.node_type || null,
    age_range: msg.filters.age_range || null,
    search: msg.filters.search || null
  };
  
  applyFilters();
}

/**
 * Applies current filters to comments and sends filtered results to UI
 */
function applyFilters() {
  if (allComments.length === 0) {
    return;
  }
  
  let filtered = allComments.slice();
  
  if (currentFilters.status) {
    switch (currentFilters.status) {
      case 'resolved':
        filtered = filtered.filter(function(c) { return c.resolved; });
        break;
      case 'unresolved':
        filtered = filtered.filter(function(c) { return !c.resolved; });
        break;
      case 'active':
        filtered = filtered.filter(function(c) { return c.status_category === 'active'; });
        break;
      case 'recent':
        filtered = filtered.filter(function(c) { return c.status_category === 'recent'; });
        break;
    }
  }
  
  if (currentFilters.author) {
    filtered = filtered.filter(function(c) { 
      return c.author.id === currentFilters.author; 
    });
  }
  
  if (currentFilters.page) {
    filtered = filtered.filter(function(c) { 
      return c.location.page_id === currentFilters.page; 
    });
  }
  
  if (currentFilters.node_type) {
    filtered = filtered.filter(function(c) { 
      return c.location.node_type === currentFilters.node_type; 
    });
  }
  
  if (currentFilters.age_range) {
    switch (currentFilters.age_range) {
      case 'today':
        filtered = filtered.filter(function(c) { return c.age_days === 0; });
        break;
      case 'week':
        filtered = filtered.filter(function(c) { return c.age_days < 7; });
        break;
      case 'month':
        filtered = filtered.filter(function(c) { return c.age_days < 30; });
        break;
      case 'older':
        filtered = filtered.filter(function(c) { return c.age_days >= 30; });
        break;
    }
  }
  
  if (currentFilters.search && currentFilters.search.trim()) {
    const searchLower = currentFilters.search.toLowerCase().trim();
    filtered = filtered.filter(function(c) {
      return c.message.toLowerCase().includes(searchLower) ||
             c.author.name.toLowerCase().includes(searchLower) ||
             (c.location.display && c.location.display.toLowerCase().includes(searchLower));
    });
  }
  
  sendMessage({
    type: 'filtered-comments',
    comments: filtered,
    count: filtered.length,
    filters_applied: currentFilters
  });
}

/**
 * Handles navigation to a comment's location
 */
function handleNavigateToComment(msg) {
  if (!msg.comment_id || typeof msg.comment_id !== 'string') {
    sendError('Invalid comment ID');
    return;
  }
  
  const comment = allComments.find(function(c) { return c.id === msg.comment_id; });
  
  if (!comment) {
    sendMessage({
      type: 'navigation-complete',
      success: false,
      message: 'Comment not found',
      comment_id: msg.comment_id
    });
    return;
  }
  
  const result = navigateToComment(msg.comment_id, comment);
  
  sendMessage({
    type: 'navigation-complete',
    success: result.success,
    message: result.message,
    comment_id: msg.comment_id,
    navigated_to: result.navigated_to,
    page_name: result.page_name,
    node_id: result.node_id,
    node_name: result.node_name,
    node_type: result.node_type,
    warning: result.warning,
    info: result.info
  });
}

/**
 * Navigates to a comment's location in the Figma file
 */
function navigateToComment(commentId, comment) {
  if (!commentId || typeof commentId !== 'string') {
    return {
      success: false,
      message: 'Invalid comment ID'
    };
  }

  if (!comment || typeof comment !== 'object') {
    return {
      success: false,
      message: 'Comment data not available'
    };
  }

  try {
    if (comment.node_id) {
      return navigateToNode(comment.node_id, comment);
    }
    
    if (comment.location && comment.location.page_id) {
      return navigateToPage(comment.location.page_id, comment);
    }
    
    return handleFileLevelComment(comment);
    
  } catch (error) {
    console.error('Navigation error:', error);
    return {
      success: false,
      message: 'Navigation failed: ' + error.message
    };
  }
}

/**
 * Navigates to a specific node
 */
function navigateToNode(nodeId, comment) {
  try {
    let targetNode;
    
    try {
      targetNode = figma.getNodeById(nodeId);
    } catch (error) {
      return handleMissingNode(nodeId, comment);
    }
    
    if (!targetNode) {
      return handleMissingNode(nodeId, comment);
    }
    
    const page = findNodePage(targetNode);
    
    if (!page) {
      return {
        success: false,
        message: 'Could not determine page for node'
      };
    }
    
    figma.currentPage = page;
    
    if (isVisibleNode(targetNode)) {
      return selectAndZoomToNode(targetNode, comment);
    } else {
      return {
        success: true,
        message: 'Navigated to page (node is not directly visible)',
        navigated_to: 'page',
        page_name: page.name
      };
    }
    
  } catch (error) {
    console.error('Error navigating to node:', error);
    return {
      success: false,
      message: 'Failed to navigate to node: ' + error.message
    };
  }
}

/**
 * Finds the page that contains a given node
 */
function findNodePage(node) {
  if (!node) {
    return null;
  }
  
  if (node.type === 'PAGE') {
    return node;
  }
  
  let current = node.parent;
  while (current) {
    if (current.type === 'PAGE') {
      return current;
    }
    if (!current.parent || current === current.parent) {
      break;
    }
    current = current.parent;
  }
  
  return findNodeInPages(node);
}

/**
 * Searches all pages for a node
 */
function findNodeInPages(node) {
  const pages = figma.root.children;
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.type === 'PAGE') {
      if (isNodeInPage(node, page)) {
        return page;
      }
    }
  }
  
  return null;
}

/**
 * Checks if a node is within a page's subtree
 */
function isNodeInPage(node, page) {
  if (!node || !page) {
    return false;
  }
  
  let current = node;
  while (current) {
    if (current === page) {
      return true;
    }
    if (!current.parent || current === current.parent) {
      return false;
    }
    current = current.parent;
  }
  
  return false;
}

/**
 * Checks if a node is visible and can be selected/zoomed
 */
function isVisibleNode(node) {
  if (!node) {
    return false;
  }
  
  const visibleTypes = [
    'FRAME',
    'GROUP',
    'COMPONENT',
    'INSTANCE',
    'RECTANGLE',
    'ELLIPSE',
    'POLYGON',
    'STAR',
    'VECTOR',
    'TEXT',
    'LINE',
    'BOOLEAN_OPERATION',
    'SLICE',
    'STAMP',
    'SHAPE_WITH_TEXT',
    'CONNECTOR',
    'CODE_BLOCK',
    'STICKY',
    'WIDGET',
    'EMBED',
    'LINK_UNFURL',
    'MEDIA',
    'SECTION',
    'HIGHLIGHT',
    'WASHI_TAPE'
  ];
  
  return visibleTypes.indexOf(node.type) !== -1;
}

/**
 * Selects a node and zooms to it
 */
function selectAndZoomToNode(node, comment) {
  try {
    const page = findNodePage(node);
    if (page) {
      figma.currentPage = page;
    }
    
    let targetNodes = [node];
    
    figma.currentPage.selection = targetNodes;
    figma.viewport.scrollAndZoomIntoView(targetNodes);
    
    return {
      success: true,
      message: 'Navigated to comment location',
      navigated_to: 'node',
      node_id: node.id,
      node_name: node.name || 'Unnamed',
      node_type: node.type,
      page_name: page ? page.name : 'Unknown'
    };
    
  } catch (error) {
    console.error('Error selecting and zooming to node:', error);
    
    const page = findNodePage(node);
    if (page) {
      figma.currentPage = page;
      return {
        success: true,
        message: 'Navigated to page (could not zoom to node)',
        navigated_to: 'page',
        page_name: page.name
      };
    }
    
    return {
      success: false,
      message: 'Failed to navigate to node: ' + error.message
    };
  }
}

/**
 * Handles navigation when a node is missing
 */
function handleMissingNode(nodeId, comment) {
  if (comment.location && comment.location.page_id) {
    try {
      const page = figma.getNodeById(comment.location.page_id);
      if (page && page.type === 'PAGE') {
        figma.currentPage = page;
        return {
          success: true,
          message: 'Navigated to page (node may have been deleted)',
          navigated_to: 'page',
          page_name: page.name,
          warning: 'The original node referenced by this comment may have been deleted'
        };
      }
    } catch (error) {
      console.warn('Could not find page:', comment.location.page_id);
    }
  }
  
  if (comment.location && comment.location.page_name) {
    const page = findPageByName(comment.location.page_name);
    if (page) {
      figma.currentPage = page;
      return {
        success: true,
        message: 'Navigated to page by name (node not found)',
        navigated_to: 'page',
        page_name: page.name,
        warning: 'The original node referenced by this comment may have been deleted'
      };
    }
  }
  
  return {
    success: false,
    message: 'Node not found. It may have been deleted or moved to a different file.',
    node_id: nodeId
  };
}

/**
 * Navigates to a specific page
 */
function navigateToPage(pageId, comment) {
  try {
    let page;
    
    try {
      page = figma.getNodeById(pageId);
      if (!page || page.type !== 'PAGE') {
        throw new Error('Node is not a page');
      }
    } catch (error) {
      if (comment.location && comment.location.page_name) {
        page = findPageByName(comment.location.page_name);
      }
      
      if (!page) {
        return {
          success: false,
          message: 'Page not found. It may have been deleted or renamed.'
        };
      }
    }
    
    figma.currentPage = page;
    figma.viewport.scrollAndZoomIntoView([page]);
    
    return {
      success: true,
      message: 'Navigated to page',
      navigated_to: 'page',
      page_name: page.name
    };
    
  } catch (error) {
    console.error('Error navigating to page:', error);
    return {
      success: false,
      message: 'Failed to navigate to page: ' + error.message
    };
  }
}

/**
 * Finds a page by name
 */
function findPageByName(pageName) {
  if (!pageName) {
    return null;
  }
  
  const pages = figma.root.children;
  const searchName = pageName.toLowerCase().trim();
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.type === 'PAGE' && page.name.toLowerCase().trim() === searchName) {
      return page;
    }
  }
  
  return null;
}

/**
 * Handles file-level comments
 */
function handleFileLevelComment(comment) {
  try {
    const pages = figma.root.children;
    if (pages.length > 0) {
      const firstPage = pages.find(function(p) { return p.type === 'PAGE'; });
      if (firstPage) {
        figma.currentPage = firstPage;
        return {
          success: true,
          message: 'This is a file-level comment (no specific location)',
          navigated_to: 'file',
          page_name: firstPage.name,
          info: 'File-level comments are not associated with a specific node or page'
        };
      }
    }
    
    return {
      success: false,
      message: 'This is a file-level comment with no specific location to navigate to'
    };
    
  } catch (error) {
    console.error('Error handling file-level comment:', error);
    return {
      success: false,
      message: 'Could not handle file-level comment: ' + error.message
    };
  }
}

/**
 * Handles UI resize requests
 */
function handleResize(msg) {
  if (msg.width && msg.height) {
    figma.ui.resize(
      Math.max(300, Math.min(800, msg.width)),
      Math.max(400, Math.min(1000, msg.height))
    );
  }
}

/**
 * Fetches all comments from the current Figma file
 */
async function fetchComments() {
  try {
    if (!OAUTH_TOKEN) {
      sendMessage({
        type: 'error',
        message: 'OAuth token not set. Please configure authentication.',
        requiresAuth: true
      });
      return;
    }

    const fileKey = figma.fileKey;
    
    if (!fileKey) {
      sendError('File key is unavailable. Make sure you are in a valid Figma file.');
      return;
    }

    sendMessage({
      type: 'fetching',
      message: 'Fetching comments...'
    });

    const url = 'https://api.figma.com/v1/files/' + fileKey + '/comments';
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Figma-Token': OAUTH_TOKEN
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'HTTP ' + response.status + ': ' + response.statusText;
      
      if (response.status === 401) {
        errorMessage = 'Authentication failed. Please check your OAuth token.';
      } else if (response.status === 403) {
        errorMessage = 'Access forbidden. You may not have permission to view comments.';
      } else if (response.status === 404) {
        errorMessage = 'File not found or comments endpoint unavailable.';
      } else if (response.status === 429) {
        errorMessage = 'Rate limit exceeded. Please try again later.';
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (!data.comments || !Array.isArray(data.comments)) {
      throw new Error('Invalid response format from Figma API');
    }

    const processedComments = data.comments.map(function(comment) {
      let pageInfo = null;
      let nodeInfo = null;
      
      if (comment.client_meta && comment.client_meta.node_id) {
        try {
          const node = figma.getNodeById(comment.client_meta.node_id);
          
          if (node) {
            let current = node;
            while (current && current.type !== 'PAGE') {
              current = current.parent;
            }
            
            if (current && current.type === 'PAGE') {
              pageInfo = {
                id: current.id,
                name: current.name
              };
            }
            
            nodeInfo = {
              id: node.id,
              name: node.name || 'Unnamed',
              type: node.type
            };
          }
        } catch (error) {
          console.warn('Could not find node for comment:', comment.id);
        }
      }

      const author = {
        id: comment.user ? comment.user.id : null,
        name: comment.user ? (comment.user.handle || comment.user.name || 'Unknown') : 'Unknown',
        avatar: comment.user ? comment.user.img_url : null
      };

      const isResolved = comment.resolved_at !== null && comment.resolved_at !== undefined;

      return {
        id: comment.id,
        author: author,
        created_at: comment.created_at,
        resolved: isResolved,
        resolved_at: comment.resolved_at,
        message: comment.message || '',
        parent_id: comment.parent_id || null,
        node_id: comment.client_meta ? comment.client_meta.node_id : null,
        node_offset: comment.client_meta ? comment.client_meta.node_offset : null,
        page: pageInfo,
        node: nodeInfo
      };
    });

    allComments = normalizeComments(processedComments);
    const summary = createCommentSummary(allComments);

    sendMessage({
      type: 'comments-loaded',
      comments: allComments,
      summary: summary,
      count: allComments.length,
      message: 'Successfully loaded ' + allComments.length + ' comment(s)'
    });

  } catch (error) {
    console.error('Error fetching comments:', error);
    sendError(error.message || 'Failed to fetch comments');
  }
}

/**
 * Normalizes comments for dashboard
 */
function normalizeComments(rawComments) {
  if (!Array.isArray(rawComments)) {
    return [];
  }

  const now = new Date();
  const normalized = [];

  rawComments.forEach(function(comment) {
    const createdDate = new Date(comment.created_at);
    const resolvedDate = comment.resolved_at ? new Date(comment.resolved_at) : null;
    const ageInDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
    const daysToResolve = resolvedDate 
      ? Math.floor((resolvedDate - createdDate) / (1000 * 60 * 60 * 24))
      : null;

    let statusLabel;
    let statusCategory;
    
    if (comment.resolved) {
      statusLabel = 'Resolved';
      statusCategory = 'resolved';
    } else {
      if (ageInDays === 0) {
        statusLabel = 'Today';
        statusCategory = 'recent';
      } else if (ageInDays === 1) {
        statusLabel = 'Yesterday';
        statusCategory = 'recent';
      } else if (ageInDays < 7) {
        statusLabel = ageInDays + ' days ago';
        statusCategory = 'recent';
      } else {
        statusLabel = 'Active';
        statusCategory = 'active';
      }
    }

    const createdDateFormatted = formatDate(createdDate);
    const resolvedDateFormatted = resolvedDate ? formatDate(resolvedDate) : null;

    let locationDisplay = 'File';
    if (comment.page) {
      locationDisplay = comment.page.name;
      if (comment.node) {
        locationDisplay += ' > ' + comment.node.name;
      }
    } else if (comment.node) {
      locationDisplay = comment.node.name;
    }

    const normalizedComment = {
      id: comment.id,
      parent_id: comment.parent_id || null,
      is_reply: !!comment.parent_id,
      author: {
        id: comment.author.id || null,
        name: comment.author.name || 'Unknown',
        avatar: comment.author.avatar || null
      },
      message: comment.message || '',
      message_preview: truncateText(comment.message || '', 100),
      resolved: comment.resolved || false,
      status_label: statusLabel,
      status_category: statusCategory,
      created_at: comment.created_at,
      created_at_formatted: createdDateFormatted,
      resolved_at: comment.resolved_at || null,
      resolved_at_formatted: resolvedDateFormatted,
      created_timestamp: createdDate.getTime(),
      resolved_timestamp: resolvedDate ? resolvedDate.getTime() : null,
      age_days: ageInDays,
      age_days_formatted: formatAge(ageInDays),
      days_to_resolve: daysToResolve,
      days_to_resolve_formatted: daysToResolve !== null ? formatAge(daysToResolve) : null,
      location: {
        page_id: comment.page ? comment.page.id : null,
        page_name: comment.page ? comment.page.name : null,
        node_id: comment.node_id || null,
        node_name: comment.node ? comment.node.name : null,
        node_type: comment.node ? comment.node.type : null,
        display: locationDisplay
      },
      node_offset: comment.node_offset || null,
      metadata: {
        has_location: !!(comment.page || comment.node),
        has_node: !!comment.node,
        is_recent: ageInDays < 7,
        is_old: ageInDays > 30,
        is_urgent: !comment.resolved && ageInDays > 7,
        author_id: comment.author.id || null,
        page_id: comment.page ? comment.page.id : null,
        node_type: comment.node ? comment.node.type : null
      }
    };

    normalized.push(normalizedComment);
  });

  const threads = {};
  normalized.forEach(function(comment) {
    if (comment.parent_id) {
      if (!threads[comment.parent_id]) {
        threads[comment.parent_id] = [];
      }
      threads[comment.parent_id].push(comment.id);
    }
  });

  normalized.forEach(function(comment) {
    if (threads[comment.id]) {
      comment.thread = {
        reply_count: threads[comment.id].length,
        has_replies: true
      };
    } else {
      comment.thread = {
        reply_count: 0,
        has_replies: false
      };
    }
  });

  return normalized;
}

/**
 * Creates summary statistics
 */
function createCommentSummary(normalizedComments) {
  const total = normalizedComments.length;
  const resolved = normalizedComments.filter(function(c) { return c.resolved; }).length;
  const unresolved = total - resolved;
  const replies = normalizedComments.filter(function(c) { return c.is_reply; }).length;
  const topLevel = total - replies;
  
  const byStatus = {
    active: normalizedComments.filter(function(c) { return c.status_category === 'active'; }).length,
    resolved: normalizedComments.filter(function(c) { return c.status_category === 'resolved'; }).length,
    recent: normalizedComments.filter(function(c) { return c.status_category === 'recent'; }).length
  };
  
  const byAge = {
    today: normalizedComments.filter(function(c) { return c.age_days === 0; }).length,
    this_week: normalizedComments.filter(function(c) { return c.age_days < 7; }).length,
    this_month: normalizedComments.filter(function(c) { return c.age_days < 30; }).length,
    older: normalizedComments.filter(function(c) { return c.age_days >= 30; }).length
  };
  
  const unresolvedComments = normalizedComments.filter(function(c) { return !c.resolved; });
  const oldestUnresolved = unresolvedComments.length > 0
    ? unresolvedComments.reduce(function(oldest, current) {
        return current.age_days > oldest.age_days ? current : oldest;
      })
    : null;
  
  const byAuthor = {};
  normalizedComments.forEach(function(comment) {
    const authorId = comment.author.id || 'unknown';
    if (!byAuthor[authorId]) {
      byAuthor[authorId] = {
        id: authorId,
        name: comment.author.name,
        count: 0,
        resolved: 0,
        unresolved: 0
      };
    }
    byAuthor[authorId].count++;
    if (comment.resolved) {
      byAuthor[authorId].resolved++;
    } else {
      byAuthor[authorId].unresolved++;
    }
  });
  
  return {
    totals: {
      all: total,
      resolved: resolved,
      unresolved: unresolved,
      replies: replies,
      top_level: topLevel
    },
    by_status: byStatus,
    by_age: byAge,
    oldest_unresolved: oldestUnresolved ? {
      id: oldestUnresolved.id,
      age_days: oldestUnresolved.age_days,
      message_preview: oldestUnresolved.message_preview
    } : null,
    by_author: Object.keys(byAuthor).map(function(key) { return byAuthor[key]; }),
    resolution_rate: total > 0 ? Math.round((resolved / total) * 100) : 0,
    average_age_days: total > 0 
      ? Math.round(normalizedComments.reduce(function(sum, c) { return sum + c.age_days; }, 0) / total)
      : 0
  };
}

/**
 * Formats a date to a readable string
 */
function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 'Invalid date';
  }
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const commentDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today - commentDate) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } else {
    const yearOption = date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {};
    return date.toLocaleDateString('en-US', Object.assign({ 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric', 
      minute: '2-digit' 
    }, yearOption));
  }
}

/**
 * Formats age in days to a readable string
 */
function formatAge(days) {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 7) return days + ' days';
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week' : weeks + ' weeks';
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month' : months + ' months';
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year' : years + ' years';
}

/**
 * Truncates text to a maximum length with ellipsis
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Helper function to send messages to UI
 */
function sendMessage(message) {
  figma.ui.postMessage(message);
}

/**
 * Helper function to send error messages
 */
function sendError(message) {
  sendMessage({
    type: 'error',
    message: message
  });
}

// Send initial message when plugin loads
sendMessage({
  type: 'plugin-ready',
  message: 'Plugin initialized. Configure OAuth token to fetch comments.',
  fileKey: figma.fileKey || null
});
